/**
 * Helper tính toán khoảng thời gian (Time Range) cho bộ lọc phân tích
 */
function getTimeRange(period) {
  const now = new Date();
  let startDate = null;
  let endDate = null;
  let label = '7 ngày qua';
  let isHourly = false;

  switch (period) {
    case 'today': {
      // 00:00:00 ngày hôm nay đến hiện tại
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      startDate = start.toISOString();
      endDate = null;
      label = 'Hôm nay';
      isHourly = true;
      break;
    }
    case 'yesterday': {
      // 00:00:00 đến 23:59:59 của ngày hôm qua
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
      startDate = start.toISOString();
      endDate = end.toISOString();
      label = 'Hôm qua';
      isHourly = true;
      break;
    }
    case '30d': {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      endDate = null;
      label = '30 ngày qua';
      break;
    }
    case 'all': {
      startDate = null;
      endDate = null;
      label = 'Toàn thời gian';
      break;
    }
    case '7d':
    default: {
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      endDate = null;
      label = '7 ngày qua';
      break;
    }
  }

  return {
    period: period || '7d',
    startDate,
    endDate,
    label,
    isHourly
  };
}

module.exports = {
  getTimeRange
};
