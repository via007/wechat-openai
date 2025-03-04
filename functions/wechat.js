const crypto = require('crypto');
const xml2js = require('xml2js');
const axios = require('axios');

const TOKEN = 'wechattest123'; // 微信后台配置的 Token
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // 从环境变量读取
const DEFAULT_REPLY = "抱歉，我暂时无法处理您的请求，请稍后再试。";

// 主入口函数
exports.handler = async (event, context) => {
  const { httpMethod, queryStringParameters, body } = event;

  // 处理微信服务器验证 (GET 请求)
  if (httpMethod === 'GET') {
    const { signature, timestamp, nonce, echostr } = queryStringParameters || {};
    if (!signature || !timestamp || !nonce || !echostr) {
      return { statusCode: 400, body: '参数缺失' };
    }
    const arr = [TOKEN, timestamp, nonce].sort();
    const str = arr.join('');
    const hash = crypto.createHash('sha1').update(str).digest('hex');
    return {
      statusCode: hash === signature ? 200 : 403,
      body: hash === signature ? echostr : '验证失败'
    };
  }

  // 处理用户消息 (POST 请求)
  try {
    // 解析微信传来的 XML 消息
    const parser = new xml2js.Parser({ explicitArray: false });
    const parsed = await parser.parseStringPromise(body);
    if (!parsed || !parsed.xml) {
      console.error("XML解析失败:", body);
      return generateXmlResponse(null, null, DEFAULT_REPLY, 'text');
    }

    const msg = parsed.xml;
    const { ToUserName, FromUserName, MsgType } = msg;
    let replyType = 'text';
    let replyContent = DEFAULT_REPLY;

    // 判断消息类型
    if (MsgType === 'text') {
      // 文本消息：调用大模型接口进行回复
      const { Content } = msg;
      if (Content) {
        replyContent = await getAIResponse(Content);
      }
    } else if (MsgType === 'image') {
      // 图片消息：这里示例仅回复收到图片，后续可扩展图片识别或生成
      const { PicUrl } = msg;
      if (PicUrl) {
        replyContent = `您发送了一张图片，地址为：${PicUrl}\n目前暂不支持图片处理功能。`;
      } else {
        replyContent = "图片消息格式不正确。";
      }
    } else {
      // 其他消息类型暂不处理
      replyContent = "暂不支持该消息类型。";
    }

    return generateXmlResponse(FromUserName, ToUserName, replyContent, replyType);
  } catch (error) {
    console.error("处理POST请求错误:", error);
    return generateXmlResponse(null, null, DEFAULT_REPLY, 'text');
  }
};

// 调用大模型接口处理文本消息
async function getAIResponse(userMessage) {
  try {
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'deepseek-v3',
        messages: [{ role: 'user', content: userMessage }]
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 设置 5 秒超时
      }
    );
    // 若返回数据结构正确则提取回复，否则使用默认回复
    return response.data.choices && response.data.choices[0].message.content || DEFAULT_REPLY;
  } catch (error) {
    console.error("调用大模型接口错误:", error.message);
    return DEFAULT_REPLY;
  }
}

// 生成微信 XML 格式回复
function generateXmlResponse(to, from, content, msgType) {
  // 如果 to 或 from 为空，则返回简单的文本回复（防止 XML 格式错误）
  if (!to || !from) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: `<xml><Content><![CDATA[${content}]]></Content></xml>`
    };
  }

  let xml = "";
  if (msgType === 'text') {
    xml = `<xml>
  <ToUserName><![CDATA[${to}]]></ToUserName>
  <FromUserName><![CDATA[${from}]]></FromUserName>
  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
</xml>`;
  } else if (msgType === 'image') {
    // 图片回复：微信要求发送图片回复时传入 MediaId
    xml = `<xml>
  <ToUserName><![CDATA[${to}]]></ToUserName>
  <FromUserName><![CDATA[${from}]]></FromUserName>
  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
  <MsgType><![CDATA[image]]></MsgType>
  <Image>
    <MediaId><![CDATA[${content}]]></MediaId>
  </Image>
</xml>`;
  } else {
    // 默认文本回复
    xml = `<xml>
  <ToUserName><![CDATA[${to}]]></ToUserName>
  <FromUserName><![CDATA[${from}]]></FromUserName>
  <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
  <MsgType><![CDATA[text]]></MsgType>
  <Content><![CDATA[${content}]]></Content>
</xml>`;
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml' },
    body: xml
  };
}
