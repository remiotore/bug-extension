
const fs = require("fs");
const tag_js = fs.readFileSync("tag-detection.js", "utf8");
const payload_js = fs.readFileSync("payloads.js", "utf8");

let TAG_DETECTION;
eval(tag_js.split("function extractParamsFromUrl")[0]);
fs.writeFileSync("tag-detection.json", JSON.stringify(TAG_DETECTION, null, 2));

let NucleiFuzzDictionaries;
eval(payload_js);
fs.writeFileSync("payloads.json", JSON.stringify(NucleiFuzzDictionaries, null, 2));
