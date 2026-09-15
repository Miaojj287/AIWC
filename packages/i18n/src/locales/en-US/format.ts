import type { Messages } from '../zh-CN'

export const format: Messages['format'] = {
  today: 'Today',
  yesterday: 'Yesterday',
  monthDay:
    '{month, select, 1 {Jan} 2 {Feb} 3 {Mar} 4 {Apr} 5 {May} 6 {Jun} 7 {Jul} 8 {Aug} 9 {Sep} 10 {Oct} 11 {Nov} 12 {Dec} other {{month}}} {day}',
  yearMonthDay:
    '{month, select, 1 {Jan} 2 {Feb} 3 {Mar} 4 {Apr} 5 {May} 6 {Jun} 7 {Jul} 8 {Aug} 9 {Sep} 10 {Oct} 11 {Nov} 12 {Dec} other {{month}}} {day}, {year}',
  justNow: 'Just now',
  minutesAgo: '{n, plural, one {# minute ago} other {# minutes ago}}',
  hoursAgo: '{n, plural, one {# hour ago} other {# hours ago}}',
}
