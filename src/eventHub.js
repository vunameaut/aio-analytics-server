/**
 * Quản lý kết nối Real-time Server-Sent Events (SSE) đến Dashboard
 */
class RealtimeEventHub {
  constructor() {
    this.clients = new Set();
  }

  /**
   * Đăng ký một kết nối SSE từ Dashboard UI
   * @param {import('express').Request} req 
   * @param {import('express').Response} res 
   */
  subscribe(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write('data: {"type":"connected"}\n\n');
    this.clients.add(res);

    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  /**
   * Phát sóng sự kiện mới tới tất cả các Dashboard đang mở
   * @param {string} eventType 
   * @param {Object} data 
   */
  broadcast(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (err) {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Số lượng người đang mở Dashboard
   */
  get activeClientsCount() {
    return this.clients.size;
  }
}

const eventHub = new RealtimeEventHub();
module.exports = eventHub;
