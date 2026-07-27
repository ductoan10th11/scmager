import multer from 'multer';
import path from 'node:path';
import { badRequest } from './http-error';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const kpiImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (extension !== '.xlsx' || file.mimetype !== XLSX_MIME) {
      callback(badRequest('Chỉ nhận tệp Excel .xlsx đúng định dạng PL4.'));
      return;
    }
    callback(null, true);
  },
});
