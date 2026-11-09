/** 复用历史原生探针的 Responses 编码，来源提交 e0aebc1。 */
const CODEX_MCP_CALL_ID = "call_background_research";

/**
 * 包装已验证的 Responses SSE 事件；首次调用可在同一响应先输出方案标记。
 * @param {object} options 输出参数
 * @param {number} options.sequence 本次响应的独立序号
 * @param {string} [options.text] 最终文本
 * @param {object} [options.toolCall] 实际工具定义派生的调用
 * @param {string} [options.planText] 工具前的 commentary 方案文本
 * @returns {object[]} 有序事件；发送与网络生命周期由根控制器负责
 */
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

/**
 * 将事件编码为 SSE；不创建服务或记录任何正文。
 * @param {object[]} events 已构造的有序事件
 * @returns {string} 可直接写入 text/event-stream 响应的载荷
 */
export function encodeCodexSse(events) {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

