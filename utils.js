const { con } = require('./log');
function parseHeader(str) {
  // 将请求头数据按回车符切割为数组，得到每一行数据
  let arr = str.split('\r\n').filter(item => item);

  // 第一行数据为GET / HTTP/1.1，可以丢弃。
  arr.shift();

  // console.log(arr);
  /* 
    处理结果为：

    [ 'Host: localhost:8080',
      'Connection: Upgrade',
      'Pragma: no-cache',
      'Cache-Control: no-cache',
      'Upgrade: websocket',
      'Origin: file://',
      'Sec-WebSocket-Version: 13',
      'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36',
      'Accept-Encoding: gzip, deflate, br',
      'Accept-Language: zh-CN,zh;q=0.9',
      'Cookie: _ga=GA1.1.1892261700.1545540050; _gid=GA1.1.774798563.1552221410; io=7X0VY8jhwRTdRHBfAAAB',
      'Sec-WebSocket-Key: jqxd7P0Xx9TGkdMfogptRw==',
      'Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits' ]
  */

  let headers = {}; // 存储最终处理的数据

  arr.forEach(item => {
    // 需要用":"将数组切割成key和value
    let [name, value] = item.split(':');

    // 去除无用的空格，将属性名转为小写
    name = name.replace(/^\s|\s+$/g, '').toLowerCase();
    value = value.replace(/^\s|\s+$/g, '');

    // 获取所有的请求头属性
    headers[name] = value;
  });

  return headers;
}

function decodeWsFrame(data) {
  let start = 0;
  let frame = {
    isFinal: (data[start] & 0x80) === 0x80,
    opcode: data[start++] & 0xf,
    masked: (data[start] & 0x80) === 0x80,
    payloadLen: data[start++] & 0x7f,
    maskingKey: '',
    payloadData: null
  };

  if (frame.payloadLen === 126) {
    frame.payloadLen = (data[start++] << 8) + data[start++];
  } else if (frame.payloadLen === 127) {
    frame.payloadLen = 0;
    for (let i = 7; i >= 0; --i) {
      frame.payloadLen += data[start++] << (i * 8);
    }
  }

  if (frame.payloadLen) {
    if (frame.masked) {
      const maskingKey = [data[start++], data[start++], data[start++], data[start++]];

      frame.maskingKey = maskingKey;

      frame.payloadData = data.slice(start, start + frame.payloadLen).map((byte, idx) => byte ^ maskingKey[idx % 4]);
    } else {
      frame.payloadData = data.slice(start, start + frame.payloadLen);
    }
  }

  if (frame.payloadData) {
    const payloadDataStr = frame.payloadData.toString();
    try {
      frame.payloadData = JSON.parse(payloadDataStr);
    } catch (error) {
      con.log(`JSON解析消息${payloadDataStr}失败`, 'decode消息失败');
    }
  }
  // con.log(frame, 'decode消息结果');
  return frame;
}

function encodeWsFrame(data) {
  // 增加一个 json 转换
  const pdt = data.payloadData ? JSON.stringify(data.payloadData) : null;
  const isFinal = data.isFinal !== undefined ? data.isFinal : true,
    opcode = data.opcode !== undefined ? data.opcode : 1,
    payloadData = pdt ? Buffer.from(pdt) : null,
    payloadLen = payloadData ? payloadData.length : 0;

  let frame = [];

  if (isFinal) frame.push((1 << 7) + opcode);
  else frame.push(opcode);

  if (payloadLen < 126) {
    frame.push(payloadLen);
  } else if (payloadLen < 65536) {
    frame.push(126, payloadLen >> 8, payloadLen & 0xff);
  } else {
    frame.push(127);
    for (let i = 7; i >= 0; --i) {
      frame.push((payloadLen & (0xff << (i * 8))) >> (i * 8));
    }
  }

  frame = payloadData ? Buffer.concat([Buffer.from(frame), payloadData]) : Buffer.from(frame);

  // con.log(decodeWsFrame(frame), '被encode的消息');
  return frame;
}

function isChatMsg(msg) {
  return msg.type[0] === msg.type[0].toUpperCase();
}

module.exports = {
  parseHeader,
  encodeWsFrame,
  decodeWsFrame,
  isChatMsg
};
