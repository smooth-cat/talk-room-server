// 引入net模块
const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('eventemitter3');
const { parseHeader, decodeWsFrame, encodeWsFrame } = require('./utils');
const { SocketMap } = require('./socket-map');
const { Conn, ConnList } = require('./conn');
const { con } = require('./log');
const { get } = require('lodash');

class BaseServer extends EventEmitter {
  /** 默认 */
  NETWORK_DELAY = 1000;

  connList = new ConnList();
  rawServer = null;
  opt = {
    /** 监听接口 */
    port: 8080,
    /** 开启 debug 日志 */
    debug: true
  };

  extendEvent = (conn, event) => {
    conn.on(event, (...args) => this.emit(event, ...args));
  };

  constructor(opt = {}) {
    super();
    this.opt = { ...this.opt, ...opt };
    if (get(opt, 'debug')) {
      con.shouldLog = true;
    }

    // 使用net模块创建服务器，返回的是一个原始的socket对象，与Socket.io的socket对象不同。
    this.rawServer = net.createServer(socket => {
      const conn = new Conn(socket, this.opt);
      this.connList.push(conn);

      this.extendEvent(conn, 'open');
      this.extendEvent(conn, 'message');
      this.extendEvent(conn, 'heartbeatLost');
      this.extendEvent(conn, 'close');
      this.extendEvent(conn, 'invalid');

      conn.on('invalid', (e) => {
        // 删除已断开的 socket
        this.connList = this.connList.filter(it => it !== conn);
        console.log('invalid 钩子触发触发', e.reason,this.connList);
      });

      // TODO: 全部移到 conn 类中
      // conn.once('data', buffer => {
      //   // 接收到HTTP请求头数据
      //   const str = buffer.toString();

      //   // 4. 将请求头数据转为对象
      //   const headers = parseHeader(str);
      //   con.log(headers, 'Websocket升级请求头');

      //   // 5. 判断请求是否为WebSocket连接
      //   if (headers['upgrade'] !== 'websocket') {
      //     // 若当前请求不是WebSocket连接，则关闭连接
      //     con.log('非WebSocket连接');
      //     socket.end();
      //   } else if (headers['sec-websocket-version'] !== '13') {
      //     // 判断WebSocket版本是否为13，防止是其他版本，造成兼容错误
      //     con.log('WebSocket版本错误');
      //     socket.end();
      //   } else {
      //     this.upgradeWsProtocol(socket, headers);
      //     this.listenMsg(conn);
      //     this.emit('open', { conn });
      //   }
      // });
    });
    this.rawServer.listen(opt.port, () => {
      console.log(`websocket服务器正在监听端口${opt.port}`);
    });
  }

  /** 将http协议升级为 ws 协议 */
  upgradeWsProtocol = (socket, headers) => {
    // 6. 校验Sec-WebSocket-Key，完成连接
    /* 
          协议中规定的校验用GUID，可参考如下链接：
          https://tools.ietf.org/html/rfc6455#section-5.5.2
          https://stackoverflow.com/questions/13456017/what-does-258eafa5-e914-47da-95ca-c5ab0dc85b11-means-in-websocket-protocol
        */
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const key = headers['sec-websocket-key'];
    const hash = crypto.createHash('sha1'); // 创建一个签名算法为sha1的哈希对象

    hash.update(`${key}${GUID}`); // 将key和GUID连接后，更新到hash
    const result = hash.digest('base64'); // 生成base64字符串
    const header = `HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-Websocket-Accept: ${result}

`;
    // 生成供前端校验用的请求头
    socket.write(header); // 返回HTTP头，告知客户端校验结果，HTTP状态码101表示切换协议：https://httpstatuses.com/101。
    // 若客户端校验结果正确，在控制台的Network模块可以看到HTTP请求的状态码变为101 Switching Protocols，同时客户端的ws.onopen事件被触发。
    con.log(header, 'Websocket升级响应头');
  };

  /** 升级ws连接后，开始监听 ws 消息 */
  listenMsg = conn => {
    const { socket } = conn;
    // 7. 建立连接后，通过data事件接收客户端的数据并处理
    conn.on('data', buffer => {
      const data = decodeWsFrame(buffer);
      con.log(data.payloadData, 'ws数据');

      // opcode为8，表示客户端发起了断开连接
      if (data.opcode === 8) {
        con.log(data, '客户端发送离开请求');
        // 与客户端断开连接
        socket.end();
        // 删除已断开的 socket
        this.connList = this.connList.filter(it => it.socket === socket);
      } else if (data.payloadData.type === 'heartbeat') {
        this.handleHeartbeat(data.payloadData, socket);
      } else {
        con.log(data.payloadData, 'ws数据');
        this.emit('message', data, conn);
      }
    });
  };

  handleHeartbeat = (payloadData, socket) => {
    // 给客户端返回心跳
    socket.write(
      encodeWsFrame({
        payloadData
      })
    );
  };
}

module.exports = {
  BaseServer
};
