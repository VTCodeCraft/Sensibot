import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LAST_RECORD_FILE = path.join(__dirname, "lastRecord.json");
dotenv.config();

const app = express();
const PORT = 3001;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizePhone(raw) {
  if (!raw) return null;
  let num = String(raw).trim();

  if (num.startsWith("+")) {
    num = "+" + num.replace(/[^\d]/g, "").replace(/^\+?/, "");
  } else {
    num = num.replace(/\D/g, "");
  }
  num = num.replace(/^0+/, "");

  if (num.startsWith("91") && num.length === 12) {
    num = "+" + num;
  } else if (num.length === 10) {
    num = "+91" + num;
  }

  if (!/^\+91\d{10}$/.test(num)) {
    return null;
  }
  return num;
}

// 🔍 Get board ID by name
const getBoardIdByName = async (mondayToken) => {
  try {
    // Step 1: Fetch all workspaces
    const workspaceQuery = `
      query {
        workspaces {
          id
          name
        }
      }
    `;

    const workspaceRes = await axios.post('https://api.monday.com/v2', { query: workspaceQuery }, {
      headers: {
        Authorization: mondayToken,
        'Content-Type': 'application/json',
      },
    });


    const crmWorkspace = workspaceRes.data.data.workspaces.find(w => w.name === "CRM");
    if (!crmWorkspace) {
      console.warn("⚠ CRM workspace not found.");
      return null;
    }

    const workspaceId = crmWorkspace.id;

    // Step 2: Fetch boards in CRM workspace
    const boardQuery = `
      query {
        boards(workspace_ids: [${workspaceId}]) {
          id
          name
        }
      }
    `;

    const boardRes = await axios.post('https://api.monday.com/v2', { query: boardQuery }, {
      headers: {
        Authorization: mondayToken,
        'Content-Type': 'application/json',
      },
    });

    const leadsBoard = boardRes.data.data.boards.find(b => b.name === "Leads");
    if (!leadsBoard) {
      console.warn("⚠ 'Leads' board not found in CRM workspace.");
      return null;
    }

    return leadsBoard.id;

  } catch (err) {
    console.error("❌ Error fetching board ID:", err.response?.data || err.message);
    return null;
  }
};

// 🔍 Search item by phone
const searchItemByPhone = async (boardId, phoneToMatch, mondayToken) => {
  console.log(`🔎 [searchItemByPhone] Searching for phone: ${phoneToMatch} on board: ${boardId}`);
  const query = `
    query GetBoardItems {
      boards(ids: ${boardId}) {
        items_page(limit: 100) {
          items {
            id
            name
            column_values {
              id
              value
            }
          }
        }
      }
    }
  `;

  try {
    const res = await axios.post('https://api.monday.com/v2', { query }, {
      headers: {
        Authorization: mondayToken,
        'Content-Type': 'application/json',
      },
    });

    const items = res.data.data.boards[0]?.items_page?.items || [];

    // Find the item with matching phone
    const matchedItem = items.find(item => {
      const phoneCol = item.column_values.find(col => col.id === 'lead_phone');
      if (!phoneCol || !phoneCol.value) return false;

      try {
        const phoneData = JSON.parse(phoneCol.value);
        const phone = phoneData.phone?.replace(/\s+/g, '') || '';
        return phone === phoneToMatch;
      } catch (e) {
        return false;
      }
    });

    console.log(`🔎 [searchItemByPhone] Finished search for phone: ${phoneToMatch}`);
    return matchedItem || null;

  } catch (err) {
    console.error("❌ Error fetching board items:", err.response?.data || err.message);
    return null;
  }
};

// ➕ Create new lead item
const createLeadItem = async (boardId, phone, mondayToken) => {
  const columnValues = {
    lead_phone: phone,
    status: {
      label: "New Lead"
    }
  };

  const mutation = `
    mutation {
      create_item (
        board_id: ${boardId},
        item_name: "Sensibot Lead",
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) {
        id
      }
    }
  `;

  try {
    const res = await axios.post(
      'https://api.monday.com/v2',
      { query: mutation },
      {
        headers: {
          Authorization: mondayToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const item = res.data?.data?.create_item;
    if (!item) throw new Error("Item creation returned null");

    console.log(`➕ Created new lead item ID: ${item.id}`);
    return item.id;
  } catch (err) {
    console.error("❌ Error creating item:", err.response?.data || err.message);
    throw err;
  }
};

// 📝 Add activity log
const addUpdateToItem = async (itemId, message, mondayToken) => {
  try {
    console.log(`📝 Preparing to add update to item ID: ${itemId}`);

    // JSON encode the message to safely handle line breaks and quotes
    const safeMessage = JSON.stringify(message);

    const mutation = `
      mutation {
        create_update(item_id: ${itemId}, body: ${safeMessage}) {
          id
        }
      }
    `;

    const response = await axios.post(
      'https://api.monday.com/v2',
      { query: mutation },
      {
        headers: {
          Authorization: mondayToken,
          'Content-Type': 'application/json',
        },
      }
    );

    const updateId = response.data?.data?.create_update?.id;

    if (updateId) {
      console.log(`✅ Update added successfully for item ID: ${itemId} | Update ID: ${updateId}`);
      return updateId;
    } else {
      console.warn(`⚠️ No update ID returned for item ID: ${itemId}`);
      return null;
    }

  } catch (err) {
    const errorData = err.response?.data || err.message;
    console.error("❌ Error adding update:", errorData);
    throw new Error(`Failed to add update to item ID: ${itemId}`);
  }
};

const getItemUpdates = async (itemId, mondayToken) => {
  const query = `
    query {
      items(ids: [${itemId}]) {
        updates {
          id
          body
        }
      }
    }
  `;

  try {
    const response = await axios.post('https://api.monday.com/v2', { query }, {
      headers: {
        Authorization: mondayToken,
        'Content-Type': 'application/json',
      },
    });

    return response.data?.data?.items?.[0]?.updates || [];
  } catch (err) {
    console.error("❌ Error fetching updates:", err.response?.data || err.message);
    return [];
  }
};


function getLastRecordId() {
  try {
    if (fs.existsSync(LAST_RECORD_FILE)) {
      const data = JSON.parse(fs.readFileSync(LAST_RECORD_FILE, "utf8"));
      return data.lastRecordId || null;
    } else {
      console.warn("⚠️ lastRecord.json does not exist. Returning null.");
      return null;
    }
  } catch (e) {
    console.error("⚠️ Could not read lastRecordId file:", e.message);
    return null;
  }
}

function saveLastRecordId(recordId) {
  try {
    const dir = path.dirname(LAST_RECORD_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(
      LAST_RECORD_FILE,
      JSON.stringify({ lastRecordId: recordId }, null, 2),
      'utf8'
    );
    console.log(`💾 Saved lastRecordId: ${recordId} to ${LAST_RECORD_FILE}`);
  } catch (e) {
    console.error("⚠️ Failed to write lastRecordId file:", e.message);
  }
}


// ✅ Verify sensibot Token
app.post('/api/verify-token', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token is required' });

  try {
    const response = await axios.post(
      'https://api.sensibot.io/assistant/key_authentication',
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Token verification failed' });
  }
});

// ✅ OAuth Callback
app.get('/oauth/callback', async (req, res) => {
  const code = req.query.code;
  const { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } = process.env;

  try {
    const params = new URLSearchParams();
    params.append('client_id', CLIENT_ID);
    params.append('client_secret', CLIENT_SECRET);
    params.append('code', code);
    params.append('redirect_uri', REDIRECT_URI);

    const tokenRes = await axios.post('https://auth.monday.com/oauth2/token', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const access_token = tokenRes.data.access_token;
    console.log('✅ Monday Access Token:', access_token);

    res.status(200).json({
      success: true,
      access_token
    });
  } catch (err) {
    console.error('❌ OAuth error:', err.response?.data || err.message);
    res.status(500).json({ error: 'OAuth failed' });
  }
});



// Main sync route
app.post('/fetch-chats', async (req, res) => {
  const monday_token = req.headers['authorization'];
  const { to_no } = req.body;

  if (!monday_token || !to_no) {
    return res.status(400).json({ error: 'Missing Monday token or to_no' });
  }

  try {
    const normalizedPhone = normalizePhone(to_no);
    const board_id = await getBoardIdByName(monday_token);
    const activityBoardId = await getAccountActivityBoardId(monday_token);

    const chatResponse = await axios.post(`https://api.sensibot.io/assistant/allchathistory`, {
      headers: {
        Authorization: `Bearer ${process.env.SENSIBOT_API_TOKEN}`
      }
    });

    const chats = chatResponse.data;
    if (!Array.isArray(chats) || chats.length === 0) {
      return res.status(200).json({ message: "✅ No chat history found." });
    }

    const existingItem = await searchItemByPhone(board_id, normalizedPhone, monday_token);
    let itemId = existingItem?.id;

    if (!itemId) {
      itemId = await createLeadItem(board_id, normalizedPhone, monday_token);
    }

    for (const chat of chats) {
      const messageTime = new Date(chat.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      const logMessage = `💬 Message from ${chat.from_no} to ${chat.to_no} at ${messageTime}<br>${chat.message}`;

      const existingUpdates = await getItemUpdates(itemId, monday_token);
      const alreadyExists = existingUpdates.some(update => update.body.includes(chat.message));

      if (!alreadyExists) {
        await addUpdateToItem(itemId, logMessage, monday_token);
      }

      // Also add as activity
      const log = {
        call_time: chat.timestamp,
        call_duration: 60 // dummy
      };

      await addCallLogAsActivity(activityBoardId, normalizedPhone, log, monday_token);
    }

    res.status(200).json({ message: `✅ Synced ${chats.length} chat logs.` });

  } catch (err) {
    console.error("❌ Error syncing chats:", err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to sync chat logs' });
  }
});



app.use(express.static(path.join(__dirname, '../Sensibot/dist')));
app.get("/{*any}", (req, res) => {
  res.sendFile(path.join(__dirname, '../Sensibot/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
