// supertest serves each request from app.listen(0), which binds every
// interface ("::"), but it always connects to 127.0.0.1. On macOS a "::" bind
// succeeds on a port another process already holds on 127.0.0.1 (Ollama,
// Electron apps and other local tools listen in the same ephemeral range),
// and the request then reaches that process instead. The test hangs, gets a
// reset or a non-HTTP reply, or reads someone else's response body, at random
// and only on machines running such tools.
//
// Binding to 127.0.0.1 itself makes the OS hand out only ports that are free
// there. That bind is asynchronous (listen with a host resolves it first), so
// the URL gets its port just before the request is sent: superagent reads
// this.url in end(), and both await and .end(cb) go through end().
const Test = require('supertest/lib/test');

const PENDING_ORIGIN = 'http://127.0.0.1:0';
const { serverAddress, end } = Test.prototype;

Test.prototype.serverAddress = function (app, path) {
  if (app.address()) return serverAddress.call(this, app, path);
  this._server = app.listen(0, '127.0.0.1');
  this._listening = new Promise((resolve, reject) => {
    app.once('listening', resolve);
    app.once('error', reject);
  });
  return PENDING_ORIGIN + path;
};

Test.prototype.end = function (fn) {
  const listening = this._listening;
  if (!listening) return end.call(this, fn);
  this._listening = null;
  listening.then(
    () => {
      const origin = `http://127.0.0.1:${this._server.address().port}`;
      this.url = this.url.replace(PENDING_ORIGIN, origin);
      end.call(this, fn);
    },
    (error) => fn(error)
  );
  return this;
};
