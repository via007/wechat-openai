const crypto = require('crypto');
const xml2js = require('xml2js');
const axios = require('axios');

const TOKEN = 'wechattest123';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_REPLY = '当前服务不稳定，请稍后再试'; // 默认回复内容
const API_TIMEOUT = 5000; // 接口超时时间（毫秒）

// 生成微信回复XML的通用函数
const buildReplyXml = (fromUser, toUser, content) => `
  <xml>
    <ToUserName><![CDATA[${fromUser}]]></ToUserName>
    <FromUserName><![CDATA[${toUser}]]></FromUserName>
    <CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>
    <MsgType><![CDATA[text]]></MsgType>
    <Content><![CDATA[${content}]]></Content>
  </xml>
`;

exports.handler = async (event, context) => {
  const { httpMethod, queryStringParameters, body } = event;

  // 处理 GET 请求
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

  // 处理 POST 请求
  let ToUserName, FromUserName;
  try {
    // 解析XML数据
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
    const xml = await parser.parseStringPromise(body);
    ToUserName = xml.xml.ToUserName;
    FromUserName = xml.xml.FromUserName;
    const Content = xml.xml.Content;

    // 处理空内容
    if (!Content) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/xml' },
        body: buildReplyXml(FromUserName, ToUserName, '请输入有效内容')
      };
    }

    // 调用API接口（添加超时设置）
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        model: 'deepseek-v3',
        messages: [{ role: 'user', content: Content }]
      },
      {
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: API_TIMEOUT
      }
    );

    // 处理API响应数据格式
    const reply = response.data.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error('API返回数据格式异常');
    }

    // 返回正常响应
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: buildReplyXml(FromUserName, ToUserName, reply)
    };

  } catch (error) {
    console.error('处理请求时发生错误:', error);
    
    // 生成安全回复（即使解析失败也尝试构造响应）
    const safeToUser = FromUserName || '';
    const safeFromUser = ToUserName || '';
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: buildReplyXml(safeToUser, safeFromUser, DEFAULT_REPLY)
    };
  }
};