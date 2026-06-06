const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');

/**
 * Uploads a file to Supabase Storage, with fallback to local uploads directory for sandbox testing.
 * @param {string} bucketName - 'certificates', 'chat-files', 'medical-reports', 'prescriptions'
 * @param {Object} file - Express Multer file object
 * @returns {Promise<string>} - Public URL of the uploaded file
 */
async function uploadFile(bucketName, file) {
  const ext = path.extname(file.originalname);
  const fileName = `${bucketName}_${uuidv4()}${ext}`;

  const hasCredentials = 
    process.env.SUPABASE_URL && 
    process.env.SUPABASE_KEY && 
    !process.env.SUPABASE_KEY.includes('your_supabase_anon') && 
    !process.env.SUPABASE_KEY.includes('here');

  if (hasCredentials) {
    try {
      console.log(`Uploading to Supabase Storage: ${bucketName}/${fileName}`);
      const { data, error } = await supabase.storage
        .from(bucketName)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (error) {
        throw error;
      }

      const { data: publicUrlData } = supabase.storage
        .from(bucketName)
        .getPublicUrl(fileName);

      return publicUrlData.publicUrl;
    } catch (err) {
      console.warn('⚠️ Supabase upload failed, falling back to local storage:', err.message || err);
    }
  } else {
    console.log('ℹ️ Supabase credentials not configured. Using local file storage.');
  }

  // Local fallback storage
  const uploadsDir = path.join(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const filePath = path.join(uploadsDir, fileName);
  fs.writeFileSync(filePath, file.buffer);

  // Return a relative path or local host path
  const host = process.env.NODE_ENV === 'production' 
    ? 'https://healthcare-backend-1-cja1.onrender.com'
    : `http://localhost:${process.env.PORT || 3000}`;
  
  return `${host}/uploads/${fileName}`;
}

module.exports = { uploadFile };
