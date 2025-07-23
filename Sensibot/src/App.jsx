import React, { useEffect, useState } from 'react';
import axios from 'axios';

const BASE_URL = 'https://mondayserver.onrender.com'; // Update if deploying somewhere else

function App() {
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState(0);
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
      axios
        .get(`${BASE_URL}/oauth/callback?code=${code}`)
        .then((res) => {
          const { access_token } = res.data;
          if (access_token) {
            localStorage.setItem('monday_access_token', access_token);
            setAccessToken(access_token);
            window.history.replaceState({}, '', window.location.pathname);
          }
        })
        .catch((err) => {
          console.error('❌ OAuth error:', err);
          alert('❌ Monday OAuth failed.');
        });
    }

    const savedKey = localStorage.getItem('sensibot_api_key');
    if (savedKey) setStatus(200);

    const token = localStorage.getItem('monday_access_token');
    if (token) setAccessToken(token);
  }, []);

  const handleVerifyKey = async () => {
    if (!apiKey) return alert('Please enter your Sensibot API key.');

    try {
      const response = await axios.post(`${BASE_URL}/api/verify-token`, { token: apiKey });

      if (response.status === 200) {
        localStorage.setItem('sensibot_api_key', apiKey);
        alert('✅ API Key verified!');
        setStatus(200);
      } else {
        alert('❌ Invalid API key.');
        setStatus(400);
      }

      setApiKey('');
    } catch (err) {
      console.error('❌ Sensibot Verify error:', err);
      setStatus(500);
      alert('⚠️ API verification failed');
    }
  };

  const handleStartSync = async () => {
    if (syncing) return;

    const monday_token = localStorage.getItem('monday_access_token');
    const sensibot_token = localStorage.getItem('sensibot_api_key');

    if (!monday_token || !sensibot_token || !phone) {
      return alert('Please connect Monday and enter phone number.');
    }

    setSyncing(true);
    try {
      const res = await axios.post(
        `${BASE_URL}/fetch-chats`,
        { to_no: phone },
        {
          headers: {
            Authorization: monday_token,
          },
        }
      );

      alert(res.data.message || '✅ Chats synced!');
      setSynced(true);
    } catch (err) {
      console.error('❌ Sync error:', err.response?.data || err.message);
      alert('❌ Sync failed.');
      setSynced(false);
    } finally {
      setSyncing(false);
    }
  };

  const isReady =
    localStorage.getItem('sensibot_api_key') && localStorage.getItem('monday_access_token');

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', sans-serif",
        padding: '20px',
      }}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '40px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 12px 24px rgba(0, 0, 0, 0.15)',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '24px', color: '#2a2a2a' }}>
          🤖 Sensibot + Monday CRM
        </h1>

        <input
          type="password"
          placeholder="Enter your Sensibot API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{
            width: '100%',
            padding: '14px 18px',
            fontSize: '16px',
            borderRadius: '10px',
            border: '1px solid #ccc',
            marginBottom: '16px',
          }}
        />

        <button
          onClick={handleVerifyKey}
          style={{
            width: '100%',
            padding: '14px',
            fontSize: '16px',
            fontWeight: '600',
            color: 'white',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: 'none',
            borderRadius: '10px',
            cursor: 'pointer',
            marginBottom: '24px',
          }}
        >
          Verify API Key
        </button>

        {isReady && (
          <>
            <input
              type="text"
              placeholder="Enter customer phone number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              style={{
                width: '100%',
                padding: '14px 18px',
                fontSize: '16px',
                borderRadius: '10px',
                border: '1px solid #ccc',
                marginBottom: '16px',
              }}
            />

            <button
              onClick={handleStartSync}
              disabled={syncing}
              style={{
                width: '100%',
                padding: '14px',
                fontSize: '16px',
                fontWeight: '600',
                color: 'white',
                background: syncing
                  ? '#CBD5E0'
                  : synced
                  ? 'linear-gradient(135deg, #2F855A 0%, #38A169 100%)'
                  : 'linear-gradient(135deg, #38a169 0%, #48bb78 100%)',
                border: 'none',
                borderRadius: '10px',
                cursor: syncing ? 'not-allowed' : 'pointer',
                marginBottom: '16px',
              }}
            >
              {syncing ? '🔄 Syncing Chats...' : synced ? '✅ Synced' : '💬 Sync Chats'}
            </button>
          </>
        )}

        <div style={{ fontSize: '14px', fontWeight: '500' }}>
          {status === 200 && <p style={{ color: '#38a169' }}>✅ Verified successfully</p>}
          {status === 400 && <p style={{ color: '#e53e3e' }}>❌ Invalid API key</p>}
          {status === 500 && <p style={{ color: '#d69e2e' }}>⚠️ Server error, try again</p>}
        </div>
      </div>
    </div>
  );
}

export default App;
