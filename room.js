const { get, uniqBy } = require('lodash');
const { watchable } = require('watchable-proxy');
const roomList = watchable([]);
/** 自增的 roomId */
let autoRoomId = 0;

const RoomError = {
  NotFound: '房间不存在',
  Unknown: '未知错误'
};

const isRoomExist = roomId => {
  return !!roomList[roomId];
};

const addRoom = it => {
  const wrappedRoom = {
    ...it,
    msgList: [],
    roomId: autoRoomId,
    userList: [],
    msgId: 0,
    colors: createColors()
  };
  roomList[autoRoomId] = wrappedRoom;
  autoRoomId++;
  return wrappedRoom;
};

const delRoom = roomId => {
  delete roomList[roomId];
};

const addRoomMsg = (roomId, newMsg) => {
  const room = roomList[roomId];
  const user = get(room, 'userList', []).find(user => user.uid === newMsg.uid);
  const color = get(user, 'color')
  const mergedMsg = { ...newMsg, msgId: room.msgId, color };
  room.msgList.push(mergedMsg);
  room.msgId++;
  return mergedMsg;
};

const addRoomUser = (id, user) => {
  const userList = get(roomList, `${id}.userList`);
  const colors = get(roomList, `${id}.colors`);
  if (Array.isArray(userList)) {
    const color = refColor(colors);
    // 方便 watch 监听逻辑
    roomList[id].userList = [...userList, { ...user, color }];
  }
};

const delRoomUser = (id, user) => {
  const userList = get(roomList, `${id}.userList`);
  const colors = get(roomList, `${id}.colors`);
  if (Array.isArray(userList)) {
    const newList = userList.filter(it => {
      const matchUser = user.uid === it.uid;
      if (matchUser) {
        const color = it.color;
        unRefColor(colors, color);
      }
      return !matchUser;
    });
    roomList[id].userList = newList;
  }
};

const getMsgList = (roomId, fromMsgId=0) => {
  fromMsgId = Number(fromMsgId);
  const msgList = get(roomList, [roomId, 'msgList'], []);
  return msgList.filter(it => it.msgId > fromMsgId);
}

const createColors = () => {
  return colors.map(it => {
    return { color: it, refCount: 0 };
  });
};

const refColor = colors => {
  let minRefCount = Infinity;
  let minRefI = -1;
  for (let i = 0; i < colors.length; i++) {
    const { refCount } = colors[i];
    if (refCount === 0) {
      minRefI = i;
      break;
    }
    if (refCount < minRefCount) {
      minRefCount = refCount;
      minRefI = i;
    }
  }

  colors[minRefI].refCount++;
  return colors[minRefI].color;
};

const unRefColor = (colors, color) => {
  colors.forEach(it => {
    if (it.color === color) {
      it.refCount--;
    }
  });
};

/** 给每个用户标记颜色 */
const colors = [

  '#00FF00', //绿色
  
  '#0000FF', //蓝色
  
  '#FFFF00', //黄色
  
  '#00FFFF', //青色
  
  '#FF00FF', //紫色
  
  '#808080', //灰色
  
  '#A52A2A', //紫灰色
  
  '#5F9EA0', //蓝灰色
  
  '#7FFF00', //绿灰色
  
  '#D2B48C', //黄灰色
  
  '#008080', //青灰色
  
  '#FF6347', //红灰色
  
  '#ADD8E6', //浅蓝色
    
  '#000000', //黑色
];

const colorLen = colors.length;

module.exports = {
  roomList,
  addRoom,
  delRoom,
  addRoomMsg,
  addRoomUser,
  delRoomUser,
  RoomError,
  isRoomExist,
  createColors,
  refColor,
  unRefColor,
  getMsgList
};
