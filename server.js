const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');

dotenv.config();

const app = express();


app.use(cors({
  origin: function(origin, callback) {
    if (!origin || origin === 'null' || origin === 'https://pmhunts.github.io' || origin === 'http://localhost:3000') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// Connect to MongoDB with event listeners for connection status
const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error('Error: MONGODB_URI environment variable is not set.');
  process.exit(1);
}

mongoose.connect(mongoUri, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;

db.on('connected', () => {
  console.log('MongoDB Connected');
});

db.on('error', (err) => {
  console.error('MongoDB Connection Error:', err);
});

db.on('disconnected', () => {
  console.warn('MongoDB Disconnected');
});

// User Schema with validation and indexing
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  password: {
    type: String,
    required: true
  },
  passwordEntries: [{
    id: String,
    website: String,
    url: String,
    username: String,
    password: String,
    notes: String,
    created: Date,
    lastUpdated: Date
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create User model
const User = mongoose.model('User', userSchema);

// Authentication middleware with improved error handling
const auth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
      return res.status(401).send({ error: 'Authorization header missing' });
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return res.status(401).send({ error: 'Token missing' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).send({ error: 'Invalid or expired token' });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).send({ error: 'User not found' });
    }

    req.token = token;
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).send({ error: 'Please authenticate' });
  }
};

// Register endpoint
app.post('/api/users/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).send({ error: 'Username and password are required' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).send({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      password: hashedPassword,
      passwordEntries: []
    });

    await user.save();

    res.status(201).send({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(400).send({ error: error.message });
  }
});

// Login endpoint
app.post('/api/users/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).send({ error: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).send({ error: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).send({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.send({
      token,
      user: {
        id: user._id,
        username: user.username
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(400).send({ error: error.message });
  }
});

// Get user password entries
app.get('/api/passwords', auth, async (req, res) => {
  try {
    res.send({ passwordEntries: req.user.passwordEntries });
  } catch (error) {
    console.error('Get passwords error:', error);
    res.status(500).send({ error: error.message });
  }
});

// Add new password entry
app.post('/api/passwords', auth, async (req, res) => {
  try {
    const { website, url, username, password, notes } = req.body;

    const newEntry = {
      id: new mongoose.Types.ObjectId().toString(),
      website,
      url: url || '',
      username,
      password,
      notes: notes || '',
      created: new Date(),
      lastUpdated: new Date()
    };

    req.user.passwordEntries.push(newEntry);
    await req.user.save();

    res.status(201).send({ entry: newEntry });
  } catch (error) {
    console.error('Add password error:', error);
    res.status(400).send({ error: error.message });
  }
});

// Update password entry
app.patch('/api/passwords/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { website, url, username, password, notes } = req.body;

    const entryIndex = req.user.passwordEntries.findIndex(entry => entry.id === id);

    if (entryIndex === -1) {
      return res.status(404).send({ error: 'Password entry not found' });
    }

    req.user.passwordEntries[entryIndex] = {
      ...req.user.passwordEntries[entryIndex],
      website,
      url: url || '',
      username,
      password,
      notes: notes || '',
      lastUpdated: new Date()
    };

    await req.user.save();

    res.send({ entry: req.user.passwordEntries[entryIndex] });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(400).send({ error: error.message });
  }
});

// Delete password entry
app.delete('/api/passwords/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    req.user.passwordEntries = req.user.passwordEntries.filter(entry => entry.id !== id);

    await req.user.save();

    res.send({ message: 'Password entry deleted successfully' });
  } catch (error) {
    console.error('Delete password error:', error);
    res.status(500).send({ error: error.message });
  }
});

// Root route to confirm server is running
app.get('/', (req, res) => {
  res.send('SecureVault backend server is running.');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
