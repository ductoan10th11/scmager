import express, { Request, Response } from 'express';
import cors from 'cors';
import { connectDB } from './src/configs/mongo';

// Khởi tạo app
const app = express();
const PORT = process.env.PORT || 8004;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Kết nối Database
connectDB();

// Basic route để test API
app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'SCMager Backend API is running!' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
});
