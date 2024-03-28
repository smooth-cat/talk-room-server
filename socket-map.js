const { encodeWsFrame } = require('./utils');

class SocketMap extends Map {
  constructor() {
    super();
  }

  update = (key, val) => {
    const oldVal = this.get(key);
    if (!oldVal) {
      this.set(key, val);
      return;
    }

    this.set(key, { ...oldVal, ...val });
  };

  findSockets = callback => {
    const sockets = new SocketList();
    for (const [key, val] of this.entries()) {
      const found = callback(key, val);
      if (found) {
        sockets.push(key);
      }
    }
    return sockets;
  };
}

class SocketList extends Array {
  send = json => {
    this.forEach(socket => {
      socket.write(
        encodeWsFrame({
          payloadData: json
        })
      );
    });
  };
}

module.exports = {
  SocketMap,
  SocketList
};
