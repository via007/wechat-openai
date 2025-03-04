const crypto = require('crypto');
const xml2js = require('xml2js');
const axios = require('axios');

const TOKEN = 'wechattest123';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_REPLY = "抱歉，我暂时无法处理您的请求，请稍后再试。";

exports.handler = async (event, context) => {
  const { httpMethod, queryStringParameters, body } = event;

  // 处理微信服务器验证（GET 请求）
  if (httpMethod === 'GET') {
    const { signature, timestamp, nonce, echostr } = queryStringParameters || {};
    if (!signature || !timestamp || !nonce || !echostr) {
      return { statusCode: 400, body: '参数缺失' };
    }
    const str = [TOKEN, timestamp, nonce].sort().join('');
    const sha1 = crypto.createHash('sha1').update(str).digest('hex');
    return {
      statusCode: sha1 === signature ? 200 : 403,
      body: sha1 === signature ? echostr : '验证失败'
    };
  }

  // 处理用户消息（POST 请求）
  try {
    const parser = new xml2js.Parser({ explicitArray: false });
    const xml = await parser.parseStringPromise(body);

    if (!xml.xml || !xml.xml.MsgType) {
      console.warn('收到无效 XML 消息:', body);
      return generateXmlResponse(xml.xml?.FromUserName, xml.xml?.ToUserName, DEFAULT_REPLY, "text");
    }

    const { ToUserName, FromUserName, MsgType, Content, PicUrl } = xml.xml;

    let replyType = "text";
    let replyContent = DEFAULT_REPLY;

    if (MsgType === "text" && Content) {
      // 处理文本消息
      replyContent = await getAIResponse(Content);
    } else if (MsgType === "image" && PicUrl) {
      // 处理图片消息（这里只是示例，你可以调用 AI 进行图片分析）
      console.log(`收到图片消息，URL: ${PicUrl}`);
      replyType = "text"; // 你可以改成 "image" 让 AI 返回一张新图片
      replyContent = `您发送了一张图片，我暂时无法处理此图片。\n图片地址: ${PicUrl}`;
    } else {
      console.warn("收到不支持的消息类型:", MsgType);
    }

    return generateXmlResponse(FromUserName, ToUserName, replyContent, replyType);
  } catch (error) {
    console.error('处理消息时发生错误:', error);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: generateXml(DEFAULT_REPLY)
    };
  }
};

// 调用 OpenAI API，设置超时 & 处理错误
async function getAIResponse(userMessage) {
  try {
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'qwen-omni-turbo',
        messages: [{ role: 'user', content: userMessage }],
		stream:true,
		stream_options:{
			include_usage:true
		},
		modalities:["text"],
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 5 秒超时
      }
    );

    return response.data.choices?.[0]?.message?.content || DEFAULT_REPLY;
  } catch (error) {
    console.error('AI 接口请求失败:', error.message);
    return DEFAULT_REPLY;
  }
}

// 生成微信 XML 响应，支持文本和图片
function generateXmlResponse(to, from, content, msgType = "text") {
  if (!to || !from) {
    return { statusCode: 400, body: '无效的 XML 格式' };
  }

  let replyXml = "";

  if (msgType === "text") {
    replyXml = `
      <xml>
        <ToUserName><![CDATA[${to}]]></ToUserName>
        <FromUserName><![CDATA[${from}]]></FromUserName>
        <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[${content}]]></Content>
      </xml>
    `;
  } else if (msgType === "image") {
    replyXml = `
      <xml>
        <ToUserName><![CDATA[${to}]]></ToUserName>
        <FromUserName><![CDATA[${from}]]></FromUserName>
        <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
        <MsgType><![CDATA[image]]></MsgType>
        <Image>
          <MediaId><![CDATA[${content}]]></MediaId>
        </Image>
      </xml>
    `;
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/xml' },
    body: replyXml
  };
}
