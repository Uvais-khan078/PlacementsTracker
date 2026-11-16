require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Placement Tracker API is running...');
});

// Health check endpoint — frontend uses this to verify the connection
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend is connected to frontend!',
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
