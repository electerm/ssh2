# @electerm/ssh2

[English](README.md) | [中文](README_CN.md)

> [ssh2](https://github.com/mscdex/ssh2) 的分支 —— 纯 JavaScript 实现的 SSH2 客户端与服务端模块，适用于 Node.js。

本库专为 **[electerm](https://github.com/electerm/electerm)** 设计并使用，electerm 是一款开源的终端 / SSH / SFTP / FTP / Telnet / 串口 / RDP / VNC / Spice 客户端，支持 Linux、Mac、Windows 和 Android。

## 安装

```bash
npm i @electerm/ssh2
```

## 额外特性

在原版 `ssh2` 基础上，本分支新增了以下特性：

### SM2 / SM3 / SM4（国密算法）支持

完整支持国密标准（GM/T），无需原生编译，纯 JavaScript 实现：

| 算法 | 类型 | 说明 |
|------|------|------|
| `sm2kep-sha3-sm3` | 密钥交换 | 基于 SM3 哈希的 SM2 ECDH 密钥交换 |
| `ssh-sm2` | 主机密钥 / 签名 | 基于 SM3 哈希的 SM2 签名 |
| `sm4-ctr`、`sm4-cbc` | 加密 | SM4 分组密码 |
| `hmac-sm3`、`hmac-sm3-etm@openssh.com` | MAC | 基于 SM3 哈希的 HMAC |

详见 [国密使用指南](docs/SM_GUIDE.md)。

### SSH 证书登录

通过新增的 `certificate` 连接选项，支持使用 SSH 证书进行认证：

```javascript
client.connect({
  host: '127.0.0.1',
  username: 'admin',
  privateKey: fs.readFileSync('/path/to/key'),
  certificate: fs.readFileSync('/path/to/cert'),  // SSH 证书
});
```

### 增强的 Keepalive

同时支持 TCP 层（`SO_KEEPALIVE`）和 SSH 协议层的 keepalive，可靠地检测并清理失效连接。

### SFTP 非 UTF8 编码支持

新增 `encode` 选项，可处理非 UTF8 编码（如 GBK）的 SFTP 文件名和 Shell 输出：

```javascript
client.connect({
  // ...
  encode: 'gbk',
});
```

### 其他改进与修复

- 支持 `EXT_INFO` 消息
- 修复 zlib 抛出异常导致会话崩溃的问题
- 修复 SFTP 头部大文本导致连接中断的问题
- 即使服务器不同意也强制支持 RSA 密钥
- 无需原生编译 —— 将 `optionalDependencies` 替换为常规 `dependencies`

## electerm 相关项目

| 项目 | 说明 |
|------|------|
| [electerm](https://github.com/electerm/electerm) | 桌面应用（Linux、Mac、Windows） |
| [electerm-web](https://github.com/electerm/electerm-web) | 浏览器版本（含移动端） |
| [electerm-web-docker](https://github.com/electerm/electerm-web-docker) | electerm-web 的 Docker 镜像 |
| [electerm online](https://cloud.electerm.org) | 免费公共在线应用 |
| [electerm demo](https://demo.electerm.org) | 在线演示 |
| [electerm-locales](https://github.com/electerm/electerm-locales) | 多语言支持 |
| [electerm AI](https://ai.electerm.org) | 面向 electerm 用户的免费 AI |
| [electerm-android](https://github.com/electerm/electerm-android) | Android 应用 |

## License

MIT
