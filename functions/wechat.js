const crypto = require('crypto');
const xml2js = require('xml2js');
const axios = require('axios');

const TOKEN = 'wechattest123'; // 微信后台的 Token
const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // 从环境变量读取

exports.handler = async (event, context) => {
  const { httpMethod, queryStringParameters, body } = event;

  // 处理 GET 请求（微信验证）
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

  // 处理 POST 请求（用户消息）
  try {
    const parser = new xml2js.Parser({ explicitArray: false });
    const xml = await parser.parseStringPromise(body);
    const { ToUserName, FromUserName, Content } = xml.xml;

    if (!Content) {
      return { statusCode: 400, body: '消息内容为空' };
    }

    // 调用 OpenAI API
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'qwen-omni-turbo',
        messages: [{ role: 'user', content: Content }],
		stream=True,
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    const reply = response.data.choices[0].message.content;

    // 构造微信 XML 回复
    const replyXml = `
      <xml>
        <ToUserName><![CDATA[${FromUserName}]]></ToUserName>
        <FromUserName><![CDATA[${ToUserName}]]></FromUserName>
        <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[${reply}]]></Content>
      </xml>
    `;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: replyXml
    };
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      body: '服务器错误: ' + error.message
    };
  }
};