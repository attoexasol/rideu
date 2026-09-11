import express from 'express';
import { asyncHandler } from '../../../middleware/error-handler';
import { stripeWebhookHandler } from '../../../controllers/stripeWebhook.controller';

const router = express.Router();

router.post('/', asyncHandler(stripeWebhookHandler));

export default router;
