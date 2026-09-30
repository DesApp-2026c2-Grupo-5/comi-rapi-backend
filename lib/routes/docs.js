import express from 'express';
import path from 'path';
import yamljs from 'yamljs';
import swaggerUi from 'swagger-ui-express';

const swaggerDocument = yamljs.load(
  path.join(process.cwd(), 'docs', 'swagger.yml')
);

const router = express.Router();

router.use(swaggerUi.serve, swaggerUi.setup(swaggerDocument));

export default router;
