import { chromium } from "playwright"
import { 
  TELEGRAM_BOT_TOKEN, 
  TELEGRAM_CHAT_ID, 
  RETRIES_TIMEOUT, 
  RETRIES_MAX_COUNT,
  SHUTDOWNS_TOMORROW_PAGE,
  GROUP
} from "./constants.js"
import { getCurrentTime } from "./helpers.js"

let getTomorrowDataRetries = 0

const getTomorrowSchedule = async () => {
  console.log("🌀 Getting TOMORROW's shutdowns data...")
  
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  
  try {
    // Используем ту же страницу, но с параметром tab=tomorrow
    await page.goto('https://www.dtek-dnem.com.ua/ua/shutdowns?tab=tomorrow', {
      waitUntil: 'networkidle',
    })
    
    // Ждем загрузки данных на завтра
    await page.waitForSelector('.schedule-list, .outage-list', { timeout: 10000 })
    
    // Парсим расписание на завтра
    const schedule = await page.evaluate(() => {
      const items = []
      const scheduleItems = document.querySelectorAll('.schedule-item, .outage-item, tr')
      
      scheduleItems.forEach(item => {
        const timeElement = item.querySelector('.time, .outage-time, td:first-child')
        const statusElement = item.querySelector('.status, .outage-status, td:nth-child(2)')
        const reasonElement = item.querySelector('.reason, .outage-reason, td:nth-child(3)')
        
        if (timeElement) {
          items.push({
            time: timeElement.textContent?.trim() || '',
            status: statusElement?.textContent?.trim() || 'Планове',
            reason: reasonElement?.textContent?.trim() || 'Ремонтні роботи'
          })
        }
      })
      
      return items
    })
    
    console.log(`✅ Got ${schedule.length} schedule items for tomorrow`)
    return schedule
    
  } catch (error) {
    console.error(`❌ Failed to get tomorrow's data: ${error.message}`)
    
    if (getTomorrowDataRetries < RETRIES_MAX_COUNT) {
      getTomorrowDataRetries++
      console.log(`🔄 Retry ${getTomorrowDataRetries}/${RETRIES_MAX_COUNT}...`)
      await new Promise(resolve => setTimeout(resolve, RETRIES_TIMEOUT))
      return await getTomorrowSchedule()
    }
    
    return []
  } finally {
    await browser.close()
  }
}

const generateTomorrowMessage = (schedule) => {
  console.log("🌀 Generating tomorrow's message...")
  
  // Получаем дату на завтра
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  
  const tomorrowDate = tomorrow.toLocaleDateString('uk-UA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
  
  // Заголовок сообщения
  let message = `📅 <b>Графік відключень на ЗАВТРА</b>\n`
  message += `<b>${tomorrowDate}</b>\n\n`
  
  // Добавляем адрес из переменных окружения
  message += `📍 ${process.env.STREET} ${process.env.HOUSE}\n`
  if (process.env.CITY) {
    message += `🏙 ${process.env.CITY}\n`
  }
  message += `\n`
  
  // Добавляем расписание
  if (schedule.length === 0) {
    message += `✅ <b>Відключень не заплановано</b>`
  } else {
    schedule.forEach(item => {
      let emoji = '⚡️'
      if (item.status.includes('План') || item.reason.includes('План')) emoji = '🔧'
      if (item.status.includes('Авар') || item.reason.includes('Авар')) emoji = '⚠️'
      if (item.status.includes('Ремонт') || item.reason.includes('Ремонт')) emoji = '🛠'
      
      message += `${emoji} <b>${item.time}</b>\n`
      message += `   ${item.reason}\n\n`
    })
  }
  
  // Добавляем время обновления
  message += `🔄 <i>Оновлено: ${getCurrentTime()}</i>`
  
  return message
}

const sendTomorrowNotification = async (message) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    throw Error("❌ Missing telegram bot token or chat id.")
  }
  
  console.log("🌀 Sending tomorrow's notification...")
  
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
          disable_notification: false,
        }),
      }
    )
    
    const data = await response.json()
    
    if (data.ok) {
      console.log("✅ Tomorrow's notification sent successfully!")
    } else {
      throw new Error(data.description)
    }
  } catch (error) {
    console.error(`❌ Failed to send tomorrow's notification: ${error.message}`)
    throw error
  }
}

async function runTomorrow() {
  console.log("🚀 Starting tomorrow's schedule generator...")
  console.log(`📍 Address: ${process.env.STREET} ${process.env.HOUSE}, ${process.env.CITY || 'Київ'}`)
  console.log(`📱 Telegram chat ID: ${TELEGRAM_CHAT_ID}`)
  
  try {
    const schedule = await getTomorrowSchedule()
    const message = generateTomorrowMessage(schedule)
    await sendTomorrowNotification(message)
    
    console.log("✨ Tomorrow's schedule completed successfully!")
  } catch (error) {
    console.error(`❌ Tomorrow's schedule failed: ${error.message}`)
    
    // Отправляем сообщение об ошибке
    try {
      const errorMessage = `❌ <b>Помилка отримання графіку на завтра</b>\n\n<code>${error.message}</code>`
      await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: errorMessage,
            parse_mode: "HTML",
          }),
        }
      )
    } catch {}
  }
}

// Запускаем если файл вызван напрямую
if (import.meta.url === `file://${process.argv[1]}`) {
  runTomorrow()
}

export { runTomorrow, getTomorrowSchedule, generateTomorrowMessage }
