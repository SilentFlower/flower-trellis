/** 固定回环mock协议；复用研究验证过的SSE载荷，不调用模型服务。 */
import { randomUUID } from "node:crypto";
const CODEX_MCP_CALL_ID="call_flower_confirmation_wait";

/** 构建Responses SSE事件；@param {object} options 序号、文本或工具；@returns {object[]} 完整事件。 */
export function buildCodexResponseEvents({ sequence, text, toolCall, planText }) {
  if (!Number.isInteger(sequence) || sequence < 1 || (typeof text === "string") === Boolean(toolCall)) {
    throw new Error("Responses 研究输出参数不合法");
  }
  const items = [];
  if (typeof planText === "string") items.push({ id: `msg_flower_plan_${sequence}`, type: "message", role: "assistant",
    phase: "commentary", status: "completed", content: [{ type: "output_text", text: planText, annotations: [], logprobs: [] }] });
  if (toolCall) items.push({ id: `fc_flower_mcp_${sequence}`, type: toolCall.type === "custom" ? "custom_tool_call" : "function_call",
    call_id: CODEX_MCP_CALL_ID, name: toolCall.name, ...(toolCall.namespace ? { namespace: toolCall.namespace } : {}),
    ...(toolCall.type === "custom" ? { input: toolCall.input } : { arguments: JSON.stringify(toolCall.arguments) }), status: "completed" });
  else items.push({ id: `msg_flower_final_${sequence}`, type: "message", role: "assistant", phase: "final_answer",
    status: "completed", content: [{ type: "output_text", text, annotations: [], logprobs: [] }] });
  const completed = { id: `resp_flower_mcp_${sequence}`, object: "response", created_at: Math.floor(Date.now() / 1000),
    status: "completed", error: null, incomplete_details: null, model: "gpt-6.1-sol", output: items,
    parallel_tool_calls: false, store: false, metadata: {}, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  const events = [{ type: "response.created", response: { ...completed, status: "in_progress", output: [] } }];
  for (const [index, item] of items.entries()) {
    const custom = item.type === "custom_tool_call";
    const message = item.type === "message";
    events.push({ type: "response.output_item.added", response_id: completed.id, output_index: index,
      item: { ...item, status: "in_progress", ...(message ? { content: [] } : custom ? { input: "" } : { arguments: "" }) } });
    if (message) {
      const part = item.content[0];
      events.push(
        { type: "response.content_part.added", item_id: item.id, output_index: index, content_index: 0, part: { ...part, text: "" } },
        { type: "response.output_text.delta", item_id: item.id, output_index: index, content_index: 0, delta: part.text, logprobs: [] },
        { type: "response.output_text.done", item_id: item.id, output_index: index, content_index: 0, text: part.text, logprobs: [] },
        { type: "response.content_part.done", item_id: item.id, output_index: index, content_index: 0, part },
      );
    } else if (custom) events.push(
      { type: "response.custom_tool_call_input.delta", item_id: item.id, output_index: index, delta: item.input },
      { type: "response.custom_tool_call_input.done", item_id: item.id, output_index: index, input: item.input },
    );
    else events.push(
      { type: "response.function_call_arguments.delta", item_id: item.id, output_index: index, delta: item.arguments },
      { type: "response.function_call_arguments.done", item_id: item.id, output_index: index, arguments: item.arguments },
    );
    events.push({ type: "response.output_item.done", response_id: completed.id, output_index: index, item });
  }
  events.push({ type: "response.completed", response: completed });
  return events.map((event, sequence_number) => ({ ...event, sequence_number }));
}


/** 编码SSE；@param {object[]} events 事件；@returns {string} 线协议文本。 */
export function encodeCodexSse(events) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}


/** 返回Messages mock；@param {object} response HTTP响应；@param {object} body 请求；@param {object[]} content 块；@returns {void}。 */
export function sendClaudeMessage(response, body, content) {
  const message = {
    id: `msg_flower_${randomUUID().replaceAll("-", "")}`,
    type: "message", role: "assistant", model: body.model || "sonnet",
    content, stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null, usage: { input_tokens: 20, output_tokens: 10 },
  };
  if (!body.stream) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(message));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event("message_start", { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 20, output_tokens: 0 } } });
  content.forEach((block, index) => {
    if (block.type === "tool_use") {
      event("content_block_start", { index, content_block: { ...block, input: {} } });
      event("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
    } else {
      event("content_block_start", { index, content_block: { type: "text", text: "" } });
      event("content_block_delta", { index, delta: { type: "text_delta", text: block.text } });
    }
    event("content_block_stop", { index });
  });
  event("message_delta", { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 10 } });
  event("message_stop", {});
  response.end();
}
