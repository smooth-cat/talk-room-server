const { BaseServer } = require('./base-server');
const Express = require('express');
const { roomList, addRoom, delRoom, addRoomMsg, RoomError, isRoomExist, delRoomUser, addRoomUser, getMsgList } = require('./room');
const bodyParser = require('body-parser');
const { isChatMsg } = require('./utils');
const { get, pick, last } = require('lodash');
const { watch } = require('watchable-proxy');
const app = new Express();

app.use(bodyParser());

app.get('/api/hello', (req, res) => {
  res.json({ hello: 'world', query: req.query });
});

app.get('/api/room', ({ query }, res) => {
  const room = roomList[query.roomId];
  res.json(room);
});

app.get('/api/roomList', (_, res) => {
  res.json(roomList);
});

app.get('/api/msgList', ({ query }, res) => {
  const list = getMsgList(query.roomId, query.msgId);
  res.json(list);
});

app.post('/api/roomCreate', ({ body }, res) => {
  console.log('body', body);
  const room = addRoom({
    roomName: body.roomName
  });
  res.json(room);
  // noticeRefresh();
});

app.post('/api/roomDelete', ({ body }, res) => {
  delRoom(body.roomId);
  res.json({});
  // noticeRefresh();
});

/** 通知其他用户刷新房间列表 */
function noticeRefresh() {
  const msg = {
    type: 'refresh_room_list',
    content: 'refresh_room_list'
  };
  server.connList
    .filter(it => {
      const notJoined = get(it, 'data.roomId') == null;
      return notJoined;
    })
    .send(msg);
}

const roomIdToDelTimer = new Map();
// 房间没人超过 3 分钟自动关闭房间
watch(roomList, ['*n.userList'], ({ oldVal, newVal, paths }) => {
  const roomId = Number(paths[paths.length-2]);
  const userCount = get(newVal, 'length');
  if (userCount === 0) {
    console.log('定时器设置');
    const noPeopleTimer = setTimeout(() => {
      console.log('定时器执行', roomId);
      // 删除房间会自动触发刷新房间列表通知
      delRoom(roomId);
      roomIdToDelTimer.delete(roomId);
    }, 60*1000);
    roomIdToDelTimer.set(roomId, noPeopleTimer);
  }

  // 如果期间用户列表恢复了就停止定时器
  if (userCount > 0) {
    console.log('定时器清除', roomId);
    clearTimeout(roomIdToDelTimer.get(roomId));
    roomIdToDelTimer.delete(roomId);
  }
});

// 房间用户发生变化时通知房间内所有人更新房间用户列表
watch(roomList, ['*n.userList'], ({ newVal, paths }) => {
  const roomId = Number(paths[paths.length - 2]);
  const msg = {
    type: 'refresh_room_user',
    content: newVal
  };

  const filtered = server.connList.filter(it => {
    const inRoom = get(it, 'data.roomId') === roomId;
    return inRoom;
  });

  filtered.send(msg);
  noticeRefresh();
});

app.listen(3000, () => {
  console.log('服务器跑在3000端口');
});

const server = new BaseServer({ port: 8080, debug: true });

server.on('message', (data, conn) => {
  const { payloadData } = data;
  console.log('接到消息', payloadData);
  // 属于聊天的消息应该发给对应房间的 websocket
  if (isChatMsg(payloadData)) {
    const { roomId } = payloadData;

    // 房间不存在则像本 socket 发送
    if (!isRoomExist(roomId)) {
      conn.send({ ...payloadData, roomError: RoomError.NotFound });
      return;
    }

    const user = pick(payloadData, ['uid', 'uname'])

    // 加入房间则
    if (get(payloadData, 'type') === 'Join') {
      // 更新连接对象 关联 data
      conn.updateData({ roomId });
      // 跟新房间本身用户列表
      addRoomUser(roomId, user)
    }

    const isLeave = get(payloadData, 'type') === 'Leave'
    // 离开房间则
    if (isLeave) {
      // 更新连接对象 关联 data
      conn.updateData({ roomId: null });
      // 跟新房间本身用户列表
      delRoomUser(roomId, user);
    }

    // 跟新房间消息列表
    const msgWithMsgId = addRoomMsg(roomId, payloadData);

    // 给同房间的 socket 转发消息
    server.connList
      .filter(it => {
        const connRoomId = get(it, 'data.roomId');
        const isSameRoom = connRoomId === roomId
        const isSelf = it === conn
        if(isSameRoom) {
          if(isSelf) {
            // 离开消息不要发给自己
            return !isLeave;
          }
          return true;
        }
      })
      .send(msgWithMsgId);
    return;
  }

  if(get(payloadData, 'type') === 'reconnect') {
    const { roomId,  lastMsgId } = get(payloadData, 'content', {});
    conn.updateData({ roomId: Number(payloadData.content.roomId) });
    // 返回房间内的消息列表
    conn.send({ ...payloadData, content:  getMsgList(roomId, lastMsgId)})
  }
});
