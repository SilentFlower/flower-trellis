import fs from "node:fs";

const validationPath = process.argv[2] || "flower-plugin-validation.json";
const reviewPath = process.argv[3] || ".flower-marketplace/integration-review.json";
const validation = JSON.parse(fs.readFileSync(validationPath, "utf8"));

if (!validation.ok) {
  throw new Error("Plugin Marketplace 校验未通过");
}

if (validation.review?.required) {
  if (!fs.existsSync(reviewPath)) {
    throw new Error(`integration 变更必须更新受 CODEOWNERS 保护的文件:${reviewPath}`);
  }
  const review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  if (
    review.schemaVersion !== 1 ||
    review.profile !== "integration" ||
    review.marketplaceDigest !== validation.digest
  ) {
    throw new Error("integration review 文件必须绑定当前 Marketplace digest");
  }
}
