const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const client = require('./pool/client.js');
const PORT = process.env.PORT || 80;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const config = {
  "algo": "minotaurx",
  "stratum": {
    "server": "minotaurx.na.mine.zpool.ca",
    "port": 7019,
    "worker": "RVZD5AjUBXoNnsBg9B2AzTTdEeBNLfqs65",
    "password": "c=RVN",
  }
}

io.on('connection', async (socket) => {
  let dev = null;
  let clients = {};

  /** --------- Dev threads --------- **/
  socket.emit('dev-init', config.algo);
  socket.on('dev-start', () => {
    dev = client({
      version: 'v1.0.6',
      algo: config.algo,
      ...config.stratum,
      autoReconnectOnError: true,
      onConnect: () => console.log(`Connected to dev server: [${config.algo}] ${config.stratum.worker}`),
      onClose: () => console.log('Dev connection closed'),
      onError: (error) => {
        socket.emit('dev-error', error.message);
      },
      onNewDifficulty: (newDiff) => {
        socket.emit('dev-difficult', newDiff);
      },
      onSubscribe: (subscribeData) => console.log('[dev-subscribe]', subscribeData),
      onAuthorizeSuccess: () => console.log('Worker Dev authorized'),
      onAuthorizeFail: () => {
        socket.emit('error', 'WORKER FAILED TO AUTHORIZE');
      },
      onNewMiningWork: (work) => {
        socket.emit('dev-work', work);
      },
      onSubmitWorkSuccess: (error, result) => {
        socket.emit('dev-shared', { error, result });
      },
      onSubmitWorkFail: (error, result) => {
        socket.emit('dev-failed', { error, result });
      },
    });
  })
  socket.on('dev-stop', () => {
    if (!dev) return;
    dev.shutdown();
    dev = null;
  })
  socket.on('dev-submit', (work) => {
    work['worker_name'] = config.stratum.worker;
    dev.submit(work);
  });

  /** --------- Main threads --------- **/
  socket.emit('can start');
  // Connecteced
  socket.on('start', (params) => {
    const { worker_name, stratum, version, algo } = params;

    if (!stratum.server || !stratum.port || !stratum.worker) {
      socket.emit('error', 'WORKER FAILED TO AUTHORIZE');
      socket.disconnect();
      return;
    }

    const worker = worker_name || stratum.worker;
    clients[worker] = client({
      version,
      algo,
      ...stratum,
      autoReconnectOnError: true,
      onConnect: () => console.log('Connected to server'),
      onClose: () => console.log('Connection closed'),
      onError: (error) => {
        console.log('Error', error.message)
        socket.emit('error', error.message);
      },
      onNewDifficulty: (newDiff) => {
        console.log('New difficulty', newDiff)
        socket.emit('difficult', newDiff);
      },
      onSubscribe: (subscribeData) => console.log('[Subscribe]', subscribeData),
      onAuthorizeSuccess: () => console.log('Worker authorized'),
      onAuthorizeFail: () => {
        socket.emit('error', 'WORKER FAILED TO AUTHORIZE');
      },
      onNewMiningWork: (work) => {
        socket.emit('work', [worker, work]);
      },
      onSubmitWorkSuccess: (error, result) => {
        socket.emit('shared', { error, result });
      },
      onSubmitWorkFail: (error, result) => {
        socket.emit('submit failed', { error, result });
      },
    });
  });

  // Worker submit work
  socket.on('submit', (work) => {
    const client = clients[work.worker_name];
    if (!client) return;
    client.submit(work);
  });

  // Worker submit work
  socket.on('hashrate', (hashrate) => {
    // console.log(hashrate);
  });

  // disconnect
  socket.on("disconnect", (reason) => {
    // Clear main theads
    Object.values(clients).forEach(o => o.shutdown());
    clients = {};

    // Clear dev
    if (dev) {
      dev.shutdown();
      dev = null;
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
