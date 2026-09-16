// Запускается через Playwright CLI: run-code --filename tools/verify-frontend.js.
// Проверяет пользовательские действия, не трогает настройки ОС или облачные данные.
async (page) => {
  const results = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    results.push(message);
  };
  await page.locator('.stat-value').first().waitFor();
  check((await page.locator('.stat-value').first().innerText()).includes('млн'), 'Метрики отформатированы');
  check(await page.locator('.donut').count() === 1, 'Диаграмма решений отображается');
  await page.screenshot({path:'output/playwright/overview-desktop.png',fullPage:true});

  // Переключаем реальные пресеты и проверяем отрисовку всех трёх типов решения.
  await page.locator('.nav-button[data-view="simulator"]').click();
  for (const [preset, action] of [['normal','approve'],['travel','challenge'],['fraud','block']]) {
    await page.locator(`[data-preset="${preset}"]`).click();
    await page.locator('#score-button').click();
    await page.locator(`#score-result .status.${action}`).waitFor();
    check(await page.locator('#score-result .explanation').count() === 3, `${preset}: результат и три объяснения`);
    if (preset === 'travel') {
      await page.locator('[data-outcome="passed"]').click();
      await page.getByText('Демо: проверка пройдена.',{exact:false}).waitFor();
      await page.screenshot({path:'output/playwright/inspector-desktop.png',fullPage:true});
    }
  }
  await page.locator('.nav-button[data-view="history"]').click();
  await page.getByText('Пройдена → разрешён').first().waitFor();
  check(await page.locator('#history-content tbody tr').count() >= 3, 'История содержит ручные решения');

  await page.locator('.nav-button[data-view="transactions"]').click();
  await page.locator('#transaction-body tr').first().waitFor();
  await page.locator('#search').fill('NO-SUCH-TRANSACTION');
  await page.getByText('Операции не найдены.',{exact:false}).waitFor();
  await page.locator('#search').fill('');
  await page.locator('#transaction-body .row-open').first().waitFor();
  check(await page.locator('#transaction-body tr').count() === 12, 'Поиск и пустое состояние работают');
  await page.locator('#action-filter').selectOption('block');
  await page.waitForFunction(() => [...document.querySelectorAll('#transaction-body .status')].every(el=>el.classList.contains('block')));
  check(await page.locator('#transaction-body .status.block').count() > 0, 'Фильтр блокировок работает');

  await page.locator('.nav-button[data-view="policy"]').click();
  await page.locator('input[name="block_cost"]').fill('4000');
  await page.locator('#policy-button').click();
  await page.waitForFunction(() => document.querySelector('#policy-state').textContent === 'Применено' && document.querySelector('#policy-button').disabled === false);
  check((await page.locator('#block-output').innerText()).includes('4'), 'Политика пересчитывается');
  await page.locator('#reset-policy').click();
  await page.waitForFunction(() => document.querySelector('#policy-button').disabled === false);

  // Проверяем оба основных экрана при мобильной ширине и отсутствие переполнения страницы.
  await page.setViewportSize({width:390,height:844});
  await page.locator('.nav-button[data-view="overview"]').click();
  const overviewFits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  check(overviewFits,'Обзор помещается в 390px без горизонтального скролла страницы');
  await page.screenshot({path:'output/playwright/overview-mobile.png',fullPage:true});
  await page.locator('.nav-button[data-view="simulator"]').click();
  await page.locator('[data-preset="travel"]').click();
  await page.locator('#score-button').click();
  await page.locator('#score-result .status.challenge').waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),'Симулятор помещается в 390px');
  await page.screenshot({path:'output/playwright/inspector-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.nav-button[data-view="overview"]').click();
  console.log(JSON.stringify(results,null,2));
  return results;
}
