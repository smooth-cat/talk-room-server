const crypto = require('crypto');
const EventEmitter = require('eventemitter3');
const { parseHeader, decodeWsFrame, encodeWsFrame } = require('./utils');
const { SocketMap } = require('./socket-map');
const { con } = require('./log');
const { get, isObjectLike } = require('lodash');

/**
 * 1. 扩展 socket 时间
 * 2. 实现心跳机制
 * 3. 增加辅助功能
 */
class Conn extends EventEmitter {
  opt = {
    /** 网络延迟 2000 */
    networkDelay: 2000,
    /** 心跳间隔 */
    heartbeatInterval: 5000,
    /** 心跳达到该次数则确认连接中断，关闭 websocket */
    maxHeartbeatLoseCount: 3
  };

  constructor(socket, opt) {
    super();
    this.socket = socket;
    this.opt = { ...this.opt, ...opt };
    socket.on('error', (e) => {
      console.log('socket报错', e);
    })
    this.onConnect();
  }

  emit = (event, ...eventArgs) => {
    const args = Array.isArray(eventArgs) ? [...eventArgs, this] : [this];
    super.emit(event, ...args);
  }

  close = ()=> {
    this.socket.end();
    clearTimeout(this.singleHeartbeatTimer);
    clearTimeout(this.heartbeatLostTimer);
  }

  /** 第一次连接时的处理 */
  onConnect = () => {
    const { socket } = this;
    socket.once('data', buffer => {
      // 接收到HTTP请求头数据
      const str = buffer.toString();

      // 4. 将请求头数据转为对象
      const headers = parseHeader(str);
      con.log(headers, 'Websocket升级请求头');

      // 5. 判断请求是否为WebSocket连接
      if (headers['upgrade'] !== 'websocket') {
        // 若当前请求不是WebSocket连接，则关闭连接
        con.log('非WebSocket连接');
        this.close();
      } else if (headers['sec-websocket-version'] !== '13') {
        // 判断WebSocket版本是否为13，防止是其他版本，造成兼容错误
        con.log('WebSocket版本错误');
        this.close();
      } else {
        this.upgradeWsProtocol(headers);
        this.listenMsg();
        this.emit('open', {});
        // 开始检测心跳
        this.startAHeartbeatCheck(true);
      }
    });
  };

  /** 将http协议升级为 ws 协议 */
  upgradeWsProtocol = headers => {
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
    this.socket.write(header); // 返回HTTP头，告知客户端校验结果，HTTP状态码101表示切换协议：https://httpstatuses.com/101。

    // 若客户端校验结果正确，在控制台的Network模块可以看到HTTP请求的状态码变为101 Switching Protocols，同时客户端的ws.onopen事件被触发。
    con.log(header, 'Websocket升级响应头');
  };



  /** 升级ws连接后，开始监听 ws 消息 */
  listenMsg = () => {
    const { socket } = this;
    // 7. 建立连接后，通过data事件接收客户端的数据并处理
    socket.on('data', buffer => {
      const data = decodeWsFrame(buffer);
      con.log(data.payloadData, 'ws数据');

      // opcode为8，表示客户端发起了断开连接
      if (data.opcode === 8) {
        con.log(data, '客户端发送离开请求');
        // 与客户端断开连接
        this.close();
        this.emit('close', {});
        this.onInvalid('close');
        // 删除已断开的 socket
        // TODO: 由 BaseServer实现
        // this.connList = this.connList.filter(it => it.socket === socket);
      } else if (data.payloadData.type === 'heartbeat') {
        this.receiveHeartbeat(data.payloadData);
      } else {
        this.emit('message', data);
      }
    });
  };

  onInvalid = reason => {
    /** 失效有两种，一种是客户端主动关闭，一种是失去心跳 */
    this.emit('invalid', { reason });
    // 失效后直接移除
    this.removeAllListeners();
  };

  currentHeartbeat = {
    id: -100
  };

  singleHeartbeatTimer = null;
  heartbeatLostTimer = null;

  /** 每隔心跳 */
  startAHeartbeatCheck = (isFirst = false) => {
    const { networkDelay, heartbeatInterval, maxHeartbeatLoseCount } = this.opt;

    // 第一次失效时间为确认升级 -> 服务端收到客户端立刻发出的心跳包，即两个网络往返时间延
    const firstTimeout = networkDelay * 2;

    // 其余的心跳检测间隔为 上一次服务端收到心跳时间 + 心跳间隔 + 网络时延
    const otherTimeout = heartbeatInterval + networkDelay;

    const timeout = isFirst ? firstTimeout : otherTimeout;

    this.singleHeartbeatTimer = setTimeout(() => {
      // 再等两个心跳的时间触发心跳丢失
      const heartbeatLostTimeout = (maxHeartbeatLoseCount - 1) * (heartbeatInterval + networkDelay);
      this.heartbeatLostTimer = setTimeout(this.onHeartbeatLost, heartbeatLostTimeout);
    }, timeout);
  };

  onHeartbeatLost = () => {
    con.log('服务端过长时间未收到心跳判定为失去心跳');
    // 与客户端断开连接
    this.close();
    this.emit('heartbeatLost', {});
    this.onInvalid('heartbeatLost');
  };

  receiveHeartbeat = payloadData => {
    this.currentHeartbeat.id = payloadData.content;
    // 收到新的心跳就把，上一个超时计时器删除
    clearTimeout(this.singleHeartbeatTimer);
    clearTimeout(this.heartbeatLostTimer);
    // 重新开始计时
    this.startAHeartbeatCheck();
    // 给客户端返回心跳
    this.send(payloadData)
  };

  data = null;
  updateData = data => {
    // 已存在就覆盖
    if (isObjectLike(data)) {
      this.data = { ...this.data, ...data };
      return;
    }
    this.data = data;
  };

  send = (json) => {
    const isOpen = ['open'].includes(this.socket.readyState); 
    // TODO: 判断有问题
    if(isOpen) {
      try {        
        this.socket.write(
          encodeWsFrame({
            payloadData: json
          })
        );
      } catch (error) {      
      }
    }
  }
}

class ConnList extends Array {
  send = json => {
    this.forEach(conn => {
      conn.send(json);
    });
  };

  // filter = (...args) => {
  //   const list = super.filter(...args);
  //   // console.log('list1', list);
  //   const cList = new ConnList(...list);
  //   return cList;
  // };
}

module.exports = {
  Conn,
  ConnList
};
