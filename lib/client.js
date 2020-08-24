"use strict";
const net = require("net");
const fs = require("fs");
const path = require("path");
const log4js = require("log4js");
const device = require("./device");
const common = require("./packet/common");
const outgoing = require("./packet/outgoing");
const imcoming = require("./packet/incoming");
const event = require("./event");
const BUF0 = Buffer.alloc(0);

class OICQError extends Error {};

const server_list = [
    {ip:"msfwifi.3g.qq.com",port:8080,ping:null},
];

//默认设置
const default_config = {
    platform:       2,      //1手机 2平板
    log_level:      "info", //trace,debug,info,warn,error,fatal,off
    kickoff:        false,  //被挤下线是否在3秒后反挤对方
    ignore_self:    true,   //群聊是否无视自己的发言
    enable_db:      false,  //启用sqlite数据库
    db_path:        path.join(process.mainModule.path, "data"),    //db文件保存路径，默认为启动文件同目录下的data文件夹
    device_path:    path.join(process.mainModule.path, "data"),    //设备文件保存路径，默认为启动文件同目录下的data文件夹
};

/**
 * @link https://nodejs.org/dist/latest/docs/api/net.html#net_class_net_socket
 */
class Client extends net.Socket {
    static OFFLINE = Symbol("OFFLINE");
    static INIT = Symbol("INIT");
    static ONLINE = Symbol("ONLINE");
}

/*** * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * @事件 事件为冒泡传递，例如request.group.add事件，若未监听会沿着request.group传递到request
 * 
 * 聊天应用事件
 * @event message 消息类(cqhttp风格命名和参数)
 *  @event message.private
 *      @event message.private.friend
 *      @event message.private.single 单向好友，对方未加你
 *      @event message.private.group
 *      @event message.private.other
 *  @event message.group
 *      @event message.group.normal
 *      @event message.group.anonymous
 *      @event message.group.notice
 * @event request 请求类(cqhttp风格命名和参数)
 *  @event request.friend
 *      @event request.friend.add
 *  @event request.group
 *      @event request.group.add
 *      @event request.group.invite
 * @event notice 通知类(命名与cqhttp略不同，统一了风格)
 *  @event notice.friend
 *      @event notice.friend.increase
 *      @event notice.friend.decrease
 *      @event notice.friend.recall
 *  @event notice.group
 *      @event notice.group.upload
 *      @event notice.group.admin       管理变动(新增布尔型字段set)
 *      @event notice.group.transfer    群主转让(有old_owner和new_owner字段)
 *      @event notice.group.recall
 *      @event notice.group.ban         禁言(通过duration判断是解禁还是禁言)
 *      @event notice.group.config      群设置变更
 *      @event notice.group.card        群名片变更
 *      @event notice.group.increase    群员增加(新增布尔型字段invite)
 *      @event notice.group.decrease    群员减少(通过operator_id判断是退群还是踢出)
 * 
 * 系统事件
 * @event system
 *  @event system.login
 *      @event system.login.captcha 验证码需要处理 {image}
 *      @event system.login.device 设备锁需要处理(暂不支持区分真假设备锁) {url}
 *      @event system.login.error 登陆失败 {message}
 *  @event system.online 上线(可以开始处理消息)
 *  @event system.offline 下线(无法自动重新登陆的时候，有下列情况)
 *      @event system.offline.network 拔线
 *      @event system.offline.frozen 账号冻结
 *      @event system.offline.kickoff 被挤下线
 *      @event system.offline.unknown 未知领域
 *  @event system.reconn 正在断线重连，重连后会触发online事件(不常发生)
 * 
 * 内部事件(一般无需监听)
 * @event internal
 *  @event internal.login login成功
 *  @event internal.kickoff 被强制下线
 *  @event internal.exception 内部异常情况
 *  @event internal.timeout 回包响应超时
 * 
 * 网络层事件(请勿随意监听，否则可能导致系统运行不正常)
 * @event pause,readable,finish,pipe,unpipe
 * @event close,connect,data,drain,end,error,lookup,ready,timeout
 * 
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 * 
 * @公开API 使用CQHTTP风格的命名和参数(函数使用驼峰非下划线)
 * 
 * @method sendPrivateMsg
 * @method sendGroupMsg
 * @method sendMsg
 * @method deleteMsg
 * @method getMsg
 * @method getForwardMsg
 * @method sendLike
 * @method setGroupKick
 * @method setGroupBan
 * @method setGroupAnonymousBan
 * @method setGroupWholeBan
 * @method setGroupAdmin
 * @method setGroupAnonymous
 * @method setGroupCard
 * @method setGroupName
 * @method setGroupLeave
 * @method setGroupSpecialTitle
 * @method setFriendAddRequest
 * @method setGroupAddRequest
 * @method getLoginInfo
 * @method getStrangerInfo
 * @method getFriendList
 * @method getGroupInfo
 * @method getGroupList
 * @method getGroupMemberInfo
 * @method getGroupMemberList
 * @method getGroupHonorInfo
 * @method getCookies
 * @method getCsrfToken
 * @method getCredentials
 * @method getRecord
 * @method getImage
 * @method canSendImage @deprecated
 * @method canSendRecord @deprecated
 * @method getStatus
 * @method getVersionInfo
 * @method setRestart
 * @method cleanCache
 * 
 * @具体实现程度请参照README
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 */
class AndroidClient extends Client {
    reconn_flag = true;
    logger;
    config;
    status = Client.OFFLINE;
    kickoff_reconn = false;

    uin = 0;
    password_md5;
    // appid = 16;
    sub_appid;
    ignore_self = true;

    nickname = "";
    age = 0;
    gender = 0;
    friend_list = new Map();
    friend_list_lock = false;
    group_list = new Map();
    group_list_lock = false;
    group_member_list = new Map();
    member_list_lock = new Set();

    heartbeat = null;
    seq_id = 0;
    req_id = 0;
    handlers = new Map();
    seq_cache = {
        "MessageSvc": new Set(),
        "PbPush": new Set(),
        "ReqPush": new Set(),
    };

    session_id = Buffer.from([0x02, 0xB0, 0x5B, 0x8B]);
    random_key = common.md5(common.rand().toString());
    ksid = Buffer.from("|454001228437590|A8.2.7.27f6ea96");
    device_info;
    captcha_sign;

    sign_info = {
        bitmap: 0,
        tgt: BUF0,
        tgt_key: BUF0,
        st_key: BUF0,
        st_web_sig: BUF0,
        s_key: BUF0,
        d2: BUF0,
        d2key: BUF0,
        ticket_key: BUF0,
        device_token: BUF0,
    };

    time_diff;
    rollback_sig;
    t104;
    t149;
    t150;
    t528;
    t530;
    pwd_flag;

    sync_finished = false;
    sync_cookie;
    pubAccountCookie;
    msgCtrlBuf;

    const1 = common.rand(9);
    const2 = common.rand(9);
    curr_msg_id;

    /**
     * @constructor
     * @param {Number} uin
     * @param {Object} config 
     */
    constructor(uin, config = {}) {
        super();
        this.uin = uin;

        config = {
            ...default_config,
            ...config
        };
        this.config = config;

        this.logger = log4js.getLogger(`[BOT:${uin}]`);
        this.logger.level = config.log_level;

        this.sub_appid = config.platform === 1 ? 537062845 : 537062409;
        this.ignore_self = config.ignore_self;
        this.kickoff_reconn = config.kickoff;

        const filepath = path.join(config.device_path, `device-${uin}.json`);
        if (!fs.existsSync(filepath))
            this.logger.info("创建了新的设备文件：" + filepath);
        this.device_info = device(filepath);

        this.on("error", (err)=>{
            this.logger.error(err.message);
        });
        this.on("close", ()=>{
            this.logger.info(`${this.remoteAddress}:${this.remotePort} closed`);
            this.stopHeartbeat();
            if (this.status === Client.OFFLINE) {
                return event.emit(this, "system.offline.network");
            }
            this.status = Client.OFFLINE;
            if (this.reconn_flag) {
                this._connect(this.changeOnlineStatus.bind(this));
                event.emit(this, "system.reconn");
            }
        });

        this.on("system.online", ()=>{
            this.status = Client.ONLINE;
        })
        this.on("system.offline", this.terminate.bind(this));

        // 在这里拆分包
        this.on("readable", ()=>{
            while (this.readableLength >= 4) {
                let len_buf = this.read(4);
                let len = len_buf.readInt32BE();
                if (this.readableLength >= len - 4) {
                    try {
                        imcoming(this.read(len - 4), this);
                    } catch (e) {
                        this.logger.trace(e);
                        this.emit("internal.exception", e);
                    }
                } else {
                    this.unshift(len_buf);
                    break;
                }
            }
        })

        this.on("internal.login", async()=>{
            this.logger.info(`Welcome, ${this.nickname} ! 正在初始化...`);
            this.changeOnlineStatus();
            this.sync_finished = false;
            this.write(outgoing.buildGetMessageRequestPacket(0, this));
            await Promise.all([
                this.getFriendList(false), this.getGroupList(false)
            ]);
            this.logger.info(`加载了${this.friend_list.size}个好友，${this.group_list.size}个群。`);
            this.group_list.forEach((v, k)=>{
                this.getGroupMemberList(k, false);
            });
        });
    }

    _connect(callback = ()=>{}) {
        if (this.status !== Client.OFFLINE) {
            return callback();
        }
        const {ip, port} = server_list[0];
        this.logger.info(`connecting to ${ip}:${port}`);
        this.connect(port, ip, ()=>{
            this.status = Client.INIT;
            this.logger.info(`${this.remoteAddress}:${this.remotePort} connected`);
            this.reconn_flag = true;
            this.resume();
            callback();
        });
    }

    nextSeq() {
        if (++this.seq_id >= 0x8000)
            this.seq_id = 1;
        return this.seq_id;
    }
    nextReq() {
        ++this.req_id;
        if (this.req_id > 0x7fffffff)
            this.req_id = 1;
        return this.req_id;
    }

    /**
     * @async reject if retcode=1
     * @param {Buffer} packet
     * @param {Number} timeout ms
     * @returns {OICQResponse}
     */
    async send(packet, timeout = 3000) {
        const seq_id = this.seq_id;
        return new Promise((resolve, reject)=>{
            this.write(packet, ()=>{
                const id = setTimeout(()=>{
                    this.handlers.delete(seq_id);
                    reject();
                    event.emit(this, "internal.timeout", {seq_id});
                }, timeout);
                this.handlers.set(seq_id, (data)=>{
                    clearTimeout(id);
                    this.handlers.delete(seq_id);
                    resolve(data);
                });
            });
        });
    }

    startHeartbeat() {
        if (this.heartbeat)
            return;
        this.heartbeat = setInterval(async()=>{
            try {
                await this.send(outgoing.buildHeartbeatRequestPacket(this));
            } catch (e) {
                //todo
            }
        }, 30000);
    }
    stopHeartbeat() {
        clearInterval(this.heartbeat);
        this.heartbeat = null;
    }

    async hasFriend(user_id) {
        if (!this.friend_list.has(user_id))
            await this.getFriendList(false);
        return this.friend_list.has(user_id);
    }
    async hasGroup(group_id) {
        if (!this.group_list.has(group_id))
            await this.getGroupList(false);
        return this.group_list.has(group_id);
    }
    async hasMember(group_id, user_id) {
        if (!this.group_member_list.has(group_id))
            await this.getGroupMemberList(group_id, false);
        const group = this.group_member_list.get(group_id);
        return group && group.has(user_id);
    }
    findStranger(user_id) {
        if (this.friend_list.has(user_id))
            return this.friend_list.get(user_id);
        for (const [k, v] of this.group_member_list) {
            if (v.has(user_id))
                return v.get(user_id);
        }
    }

    changeOnlineStatus(status = 11) {
        this.startHeartbeat();
        this.write(outgoing.buildClientRegisterRequestPacket(this));
        if (!this.listenerCount("internal.kickoff")) {
            this.once("internal.kickoff", (data)=>{
                this.status = Client.INIT;
                this.logger.warn(data.info);
                let sub_type;
                if (data.info.includes("另一")) {
                    if (this.kickoff_reconn) {
                        this.logger.info("3秒后重新连接..");
                        setTimeout(this.login.bind(this), 3000);
                    }
                    sub_type = "kickoff";
                } else if (data.info.includes("冻结")) {
                    sub_type = "frozen";
                } else {
                    sub_type = "unknown";
                }
                event.emit(this, "system.offline."+sub_type);
            })
        }
    }

    // 以下是public方法 ----------------------------------------------------------------------------------------------------

    /**
     * 密码登陆
     * @param {Buffer|String} password_md5 这里不传递明文密码
     */
    login(password_md5) {
        if (this.isOnline())
            return;
        if (password_md5) {
            try {
                if (typeof password_md5 === "string")
                    password_md5 = Buffer.from(password_md5, "hex");
                if (password_md5 instanceof Buffer && password_md5.length === 16)
                    this.password_md5 = password_md5;
                else
                    throw new Error("error");
            } catch (e) {
                throw new OICQError("Argument password_md5 is illegal.");
            }
            this.device_info = device(path.join(this.config.device_path, `device-${this.uin}.json`));
        }
        this._connect(()=>{
            this.write(outgoing.buildPasswordLoginRequestPacket(this));
        });
    }

    /**
     * 验证码登陆
     * @param {String} captcha 
     */
    captchaLogin(captcha = "abcd") {
        if (this.isOnline())
            return;
        try {
            captcha = captcha.toString().trim();
        } catch (e) {
            throw new OICQError("Illegal argument type.");
        }
        const packet = outgoing.buildCaptchaLoginRequestPacket(
            Buffer.byteLength(captcha) === 4 ? captcha : "abcd", this.captcha_sign, this
        );
        this.write(packet);
    }

    /**
     * 使用此函数关闭连接，不要使用end和destroy
     */
    terminate() {
        if (this.status === Client.OFFLINE)
            return;
        this.reconn_flag = false;
        this.end();
    }

    isOnline() {
        return this.status === Client.ONLINE;
    }

    ///////////////////////////////////////////////////

    async getFriendList(cache = true) {
        if (!cache && !this.friend_list_lock) {
            try {
                this.friend_list_lock = true;
                this.friend_list = new Map();
                let start = 0, limit = 150;
                while (1) {
                    const total = await this.send(outgoing.buildFriendListRequestPacket(start, limit, this));
                    start += limit;
                    if (start > total) break;
                }
            } catch (e) {}
        }
        this.friend_list_lock = false;
        return common.buildApiRet(0, this.friend_list);
    }
    async getGroupList(cache = true) {
        if (!cache && !this.group_list_lock) {
            try {
                this.group_list_lock = true;
                await this.send(outgoing.buildGroupListRequestPacket(this));
            } catch (e) {}
        }
        this.group_list_lock = false;
        return common.buildApiRet(0, this.group_list);
    }
    async getGroupMemberList(group_id, cache = true) {
        if (!await this.hasGroup(group_id)) {
            this.group_member_list.delete(group_id);
            return common.buildApiRet(102);
        }
        if (!this.member_list_lock.has(group_id) && (!cache || !this.group_member_list.has(group_id))) {
            try {
                this.member_list_lock.add(group_id);
                let next = 0;
                this.group_member_list.set(group_id, new Map());
                while (1) {
                    next = await this.send(outgoing.buildGroupMemberListRequestPacket(
                        this.group_list.get(group_id).uin, group_id, next, this
                    ));
                    if (!next) break;
                }
            } catch (e) {}
        }
        this.member_list_lock.delete(group_id);
        if (!this.group_member_list.has(group_id))
            return common.buildApiRet(102);
        return common.buildApiRet(0, this.group_member_list.get(group_id));
    }

    async getStrangerInfo(user_id) {
        const stranger = this.findStranger(user_id);
        if (stranger)
            return common.buildApiRet(0, stranger);
        return common.buildApiRet(102);
    }
    async getGroupInfo(group_id, cache = true) {
        if (!cache || !this.group_list.has(group_id))
            await this.getGroupList(false);
        try {
            return common.buildApiRet(0, this.group_list.get(group_id));
        } catch (e) {
            return common.buildApiRet(102);
        }
    }
    async getGroupMemberInfo(group_id, user_id, cache = true) {
        if (!cache || !this.group_member_list.has(group_id))
            await this.getGroupMemberList(group_id, false);
        try {
            return common.buildApiRet(0, this.group_member_list.get(group_id).get(user_id));
        } catch (e) {
            return common.buildApiRet(102);
        }
    }

    ///////////////////////////////////////////////////

    async sendPrivateMsg(user_id, message, auto_escape = false) {
        try {
            const packet = outgoing.buildSendFriendMessageRequestPacket(user_id, message, auto_escape, this);
            const message_id = this.curr_msg_id;
            const resp = await this.send(packet);
            if (resp.result === 0) {
                this.logger.info(`send: [Private: ${user_id}] ` + message);
                return common.buildApiRet(0, {message_id});
            }
            const stranger = this.findStranger(user_id);
            if (stranger && stranger.group_id)
                return await this.sendTempMessage(stranger.group_id, user_id, message, auto_escape, this);
            this.logger.warn(`send failed: [Private: ${user_id}] ` + resp.errmsg)
            return common.buildApiRet(102, null, {info: resp.errmsg});
        } catch (e) {}
    }
    async sendTempMsg(group_id, user_id, message, auto_escape = false) {
        try {
            const packet = outgoing.buildSendTempMessageRequestPacket(group_id, user_id, message, auto_escape, this);
            const message_id = this.curr_msg_id;
            const resp = await this.send(packet);
            if (resp.result !== 0) {
                this.logger.warn(`send failed: [Private: ${user_id}] ` + resp.errmsg)
                return common.buildApiRet(102, null, {info: resp.errmsg});
            }
            this.logger.info(`send: [Private: ${user_id}] ` + message);
            return common.buildApiRet(0, {message_id});
        } catch (e) {}
    }
    async sendGroupMsg(group_id, message, auto_escape = false) {
        try {
            const packet = outgoing.buildSendGroupMessageRequestPacket(group_id, message, auto_escape, this);
            const message_id = this.curr_msg_id;
            const resp = await this.send(packet);
            if (resp.result !== 0) {
                this.logger.warn(`send failed: [Group: ${group_id}] ` + resp.errmsg)
                return common.buildApiRet(102, null, {info: resp.errmsg});
            }
            this.logger.info(`send: [Group: ${group_id}] ` + message);
            return common.buildApiRet(0, {message_id});
        } catch (e) {}
    }

    async deleteMsg(message_id) {
        try {
            this.write(outgoing.buildGroupRecallRequestPacket(message_id, this));
        } catch (e) {
            return common.buildApiRet(100);
        }
        return common.buildApiRet(1);
    }

    ///////////////////////////////////////////////////

    //todo
    async setGroupAnonymousBan(group_id, anonymous_flag,  duration = 600) {}
    async setGroupWholeBan(group_id, enable = true) {}
    async setGroupAnonymous(group_id, enable = true) {}
    async setGroupName(group_id, group_name) {}
    async setGroupAdmin(group_id, user_id, enable = true) {}
    async setGroupSpecialTitle(group_id, user_id, special_title = "", duration = -1) {}

    ///////////////////////////////////////////////////

    async setGroupCard(group_id, user_id, card = "") {
        //todo
    }
    async setGroupKick(group_id, user_id, reject_add_request = false) {
        this.write(outgoing.buildGroupKickRequestPacket(group_id, user_id, reject_add_request, this));
        return common.buildApiRet(1);
    }
    async setGroupBan(group_id, user_id, duration = 600) {
        this.write(outgoing.buildGroupBanRequestPacket(group_id, user_id, duration, this));
        return common.buildApiRet(1);
    }
    async setGroupLeave(group_id, is_dismiss = false) {
        try {
            const res = await this.send(outgoing.buildGroupLeaveRequestPacket(group_id, this));
            return common.buildApiRet(res === 0 ? 0 : 102);
        } catch (e) {}
    }

    ///////////////////////////////////////////////////

    async setFriendAddRequest(flag, approve = true, block = false) {
        try {
            this.write(outgoing.buildFriendRequestRequestPacket(flag, approve, block, this));
            return common.buildApiRet(1);
        } catch (e) {}
        return common.buildApiRet(100);
    }
    async setGroupAddRequest(flag, approve = true, block = false, reason = undefined) {
        try {
            this.write(outgoing.buildGroupRequestRequestPacket(flag, approve, block, reason, this));
            return common.buildApiRet(1);
        } catch (e) {}
        return common.buildApiRet(100);
    }
}

//----------------------------------------------------------------------------------------------------

/**
 * @param {Number} uin 
 * @param {Object} config 
 * @returns {AndroidClient}
 */
function createClient(uin, config = {}) {
    uin = parseInt(uin);
    if (uin <= 10000 || uin >= 4000000000 || isNaN(uin))
        throw new OICQError("Argument uin is not an OICQ account.");
    if (typeof config !== "object" || config === null)
        throw new OICQError("Argument config is illegal.");
    return new AndroidClient(uin, config);
}

module.exports = {
    createClient
};
