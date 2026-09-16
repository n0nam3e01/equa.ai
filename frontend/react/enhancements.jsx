// Небольшие React-островки добавляют компоненты библиотек в существующий HTML.
// API и навигация остаются в app.js: переписывать весь проект ради эффектов не нужно.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {NumberTicker} from './vendor/number-ticker';
import FadeContent from './vendor/FadeContent';

let roots = [];
let insightRoot = null;
let previous = [];
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const format = (value, decimals=0) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:decimals}).format(value);

export function clearMetrics() {
  // React размонтируется до удаления DOM-узла, чтобы освободить Motion subscriptions.
  roots.forEach(root => root.unmount());
  roots = [];
}

export function enhanceMetrics(elements, values, fromKeyboard=false) {
  const noMotion = reducedMotion() || fromKeyboard;
  elements.forEach((element,index) => {
    const raw = values[index];
    const divider = index < 2 && raw >= 1_000_000 ? 1_000_000 : index === 2 ? .01 : 1;
    const value = raw / divider;
    const decimals = divider === 1_000_000 ? 2 : index === 2 ? 1 : 0;
    const suffix = divider === 1_000_000 ? ' млн ₸' : index < 2 ? ' ₸' : index === 2 ? '%' : '';
    const lastValue = previous[index] === undefined ? value : previous[index] / divider;
    const label = format(value,decimals) + suffix;
    element.title = index < 2 ? format(raw,2) + ' ₸' : label;
    const root = createRoot(element);
    roots.push(root);
    // Скринридер читает конечное число один раз; промежуточные кадры скрыты.
    root.render(<><span className="sr-only">{label}</span><span aria-hidden="true">
      {noMotion ? format(value,decimals) : <NumberTicker value={value} startValue={lastValue} decimalPlaces={decimals} className="equa-number"/>}{suffix}
    </span></>);
  });
  previous = [...values];
}

export function clearInsight() {
  insightRoot?.unmount();
  insightRoot = null;
}

export function enhanceInsight(element, transaction, fromKeyboard=false) {
  clearInsight();
  insightRoot = createRoot(element);
  const ratio = format(transaction.amount / transaction.average_amount,1);
  const text = `Сумма — ${ratio} среднего чека. ${transaction.new_device ? 'Устройство новое.' : 'Устройство знакомое.'} За последние 10 минут: ${transaction.frequency} операций, включая текущую.`;
  // React Bits используется только при новом результате, без blur и без задержки.
  const content = <p className="insight-copy">{text}</p>;
  insightRoot.render(reducedMotion() || fromKeyboard ? content :
    <FadeContent duration={180} blur={false} delay={0} threshold={0} initialOpacity={0.8}>{content}</FadeContent>);
}
