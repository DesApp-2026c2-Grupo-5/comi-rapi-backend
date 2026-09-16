import db from './lib/models';
import { closeSessionPool } from './lib/middlewares/session';

afterAll(async () => {
  await db.sequelize.close();
  await closeSessionPool();
});
