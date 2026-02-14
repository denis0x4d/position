/**
 * Fetches stock data from MOEX API
 * @param {string} date - Date in format YYYY-MM-DD
 * @returns {Promise<Object>} Stock data from MOEX API
 */
async function fetchMoexData(date, start = 0) {
  const url = `https://iss.moex.com/iss/history/engines/stock/markets/shares/boards/tqbr/securities.json?date=${date}&start=${start}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Ошибка при получении данных:', error);
    throw error;
  }
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


//days from yesterday, skipping weekends
function* workDaysGenerator(daysBack = 10, startDate = new Date()) {
  let current = new Date(startDate);
  let i = 0;
  while (i <= daysBack) {
    const date = new Date(current);
    date.setDate(current.getDate() - 1);
    current = date;
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }
    i++;
    yield formatDate(current);
  }
}

function divideBigInt(a, b) {
  const result = Number((a * 100n) / b) / 100;
  return Math.round(result * 10) / 10;  // Округление до 1 знака
}


async function loadData(daysBack = 10) {
  const dates = workDaysGenerator(daysBack);
  let imoexData = new Map();

  for (const date of dates) {
    let imoexDay = new Map();
    imoexData.set(date, imoexDay);
    let page = 0;
    while (page >= 0) {
      try {
        const a = await fetchMoexData(date, page);

        const columns = a.history.columns;
        const idxName = columns.indexOf('SECID');
        const idxVol = columns.indexOf('VOLUME');
        const idxDate = columns.indexOf('TRADEDATE');
        const idxClose = columns.indexOf('CLOSE');
        if (idxName === -1 || idxVol === -1 || idxDate === -1 || idxClose === -1) {
          console.log("cannot find all indexes");
          alert("cannot find all indexes");
          return;
        }
        const data = a.history.data;
        for (let i = 0; i < data.length; i++) {
          imoexDay.set(data[i][idxName], { volume: BigInt(data[i][idxVol]), turnover: data[i][idxVol] * data[i][idxClose] });
        }

        const cursor = a["history.cursor"];
        const cursorColumns = cursor.columns;
        const idxPageIndex = cursorColumns.indexOf("INDEX");
        const idxPageTotal = cursorColumns.indexOf("TOTAL");
        const idxPageSize = cursorColumns.indexOf("PAGESIZE");
        if (idxPageIndex === -1 || idxPageTotal === -1 || idxPageSize === -1) {
          console.log("cannot find all indexes for page");
          alert("cannot find all indexes for page");
          return;
        }
        const pageData = cursor.data[0];
        let pageIndex = pageData[idxPageIndex];
        let pageTotal = pageData[idxPageTotal];
        let pageSize = pageData[idxPageSize];
        if (pageIndex + pageSize >= pageTotal) {
          page = -1;
        } else {
          page += pageSize;
        }
      } catch (error) {
        console.error('Ошибка при получении данных:', error);
        alert("Ошибка при получении данных");
      }
    }
  }
  return imoexData;
}


function computeAverageVolume(imoexData) {
  let averageVolume = new Map();
  for (const [date, dayData] of imoexData.entries()) {
    for (const [secId, stockData] of dayData.entries()) {
      if (!averageVolume.has(secId)) {
        averageVolume.set(secId, { totalVolume: BigInt(0), count: 0 });
      }
      const current = averageVolume.get(secId);
      current.totalVolume += stockData.volume;
      current.count += 1;
    }
  }
  for (const [secId, data] of averageVolume.entries()) {
    data.average = data.totalVolume / BigInt(data.count);
  }
  return averageVolume;
}


function computeHotStocks(imoexData, averageVolume) {
  let hotStocks = new Map();
  for (const [date, dayData] of imoexData.entries()) {
    for (const [secId, stockData] of dayData.entries()) {
      if (!averageVolume.has(secId)) {
        continue;
      }
      const avgData = averageVolume.get(secId);
      if (avgData.average === BigInt(0)) {
        continue;
      }
      const ratio = divideBigInt(stockData.volume, avgData.average);
      if (!hotStocks.has(date)) {
        hotStocks.set(date, []);
      }
      const turnover = Math.trunc(stockData.turnover / 1e6);
      hotStocks.get(date).push({ secId, ratio, turnover });
    }
  }
  return hotStocks;
}

const cacheImoexData = new Map();

// Expose a helper to get hot stocks for the UI
async function getHotStocks(daysBack = 10) {

  const cacheKey = `hotStocks_${daysBack}_${formatDate(new Date())}`;
  if (!cacheImoexData.has(cacheKey)) {
    const moexData = await loadData(daysBack);
    const averageVolume = computeAverageVolume(moexData);
    const hotStocks = computeHotStocks(moexData, averageVolume);
    cacheImoexData.clear();
    cacheImoexData.set(cacheKey, hotStocks);  
  }
  const hotStocks = cacheImoexData.get(cacheKey);
  const out = {};
  for (const [date, arr] of hotStocks.entries()) {
    out[date] = arr;
  }
  return out;
}

window.getHotStocks = getHotStocks;

//  (async () => {
//    const hotStocks = await getHotStocks(10);
//    console.log(hotStocks);
//    const hotStocks1 = await getHotStocks(10);
//    console.log(hotStocks1);
//   })();
