# OICQ
* QQ(安卓)协议的nodejs实现，参考了[mirai](https://github.com/mamoe/mirai)和[MiraiGo](https://github.com/Mrs4s/MiraiGo)，全异步，高效、稳定、简洁，没有大量样板代码。  
* 使用[CQHTTP](https://cqhttp.cc)风格的API、事件和参数(少量差异)，并且原生支持经典的CQ码。  
* 一切旨在学习。本项目使用AGPL-3.0许可证，请勿商业化使用。
* nodejs版本必须 >= v12.16

**使用内置的控制台：**

```
# npm i
# npm test
```

**作为包引入：**

```bash
# npm i oicq
```

```js
const oicq = require("oicq");
const uin = 123456789, config = {};
const password_md5 = "202cb962ac59075b964b07152d234b70";
const bot = oicq.createClient(uin, config);
bot.login(password_md5);
```

**文档：**

[开发进度]()  
[配置]()  
[事件]()  
[API]()  
