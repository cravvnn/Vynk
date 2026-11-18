// Loaded only by the private slow-reader fixture.
const WebSocket = require('ws');
const originalSend = WebSocket.prototype.send;
const peers = new Map();
WebSocket.prototype.send = function (data, ...args) {
  const result = originalSend.call(this, data, ...args);
  if (!peers.has(this)) {
    const message = JSON.parse(data);
    if (message.t === 'welcome') peers.set(this, { id: message.selfId, peak: 0 });
  }
  const peer = peers.get(this);
  if (peer) peer.peak = Math.max(peer.peak, this.bufferedAmount);
  return result;
};
process.on('message', message => {
  if (message === 'shutdown') process.emit('SIGTERM');
  if (message === 'sample') process.send(Array.from(peers, ([socket, peer]) => ({
    ...peer, current: socket.bufferedAmount
  })));
});
