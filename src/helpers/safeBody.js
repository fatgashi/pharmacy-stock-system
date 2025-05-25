function safeBody(req) {
  return req.body ?? {};
}

module.exports = {safeBody};