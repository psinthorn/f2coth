// Builder registry — maps a template `code` to a render function that returns
// a docx `Document`. This is the single place a new contract layout is
// registered. contract-api's GET /templates capability check reads
// `Object.keys(builders)`, so a template row whose `code` has no builder here
// is rejected before anyone can create a contract that can't be rendered.
//
// To add a new contract type:
//   1. drop lib/builders/<code>.js exporting build(data, {watermark}) -> Document
//   2. register it below
//   3. seed a contract_templates row with matching `code` + merge_schema
// No server, API, or schema changes required.
const builders = {
  "service-agreement": require("./service-agreement"),
  "mutual-nda": require("./mutual-nda"),
};

function get(code) {
  return builders[code] || null;
}

function codes() {
  return Object.keys(builders);
}

module.exports = { get, codes };
