import * as dotenv from 'dotenv';
import { SimpleAgent } from './agent';

dotenv.config({path: '.env'});

// Demo Run
if (require.main === module) {
  (async () => {
    if (!process.env.OPENROUTER_API_KEY) {
      console.error('Please set OPENROUTER_API_KEY in .env file');
      process.exit(1);
    }

    const agent = new SimpleAgent();
    await agent.init();

    try {
      await agent.aiAct('打开baidu.com，查找猫咪的图片，然后保存一张到本地', { deepThink: true });
    } catch(e) {
      console.error(e);
    } finally {
      await new Promise(r => setTimeout(r, 5000));
      await agent.close();
    }
  })();
}
