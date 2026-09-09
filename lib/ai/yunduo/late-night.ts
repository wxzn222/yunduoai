export function getShanghaiHour(date: Date): number {
  const hour = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Shanghai",
  }).format(date);

  return Number.parseInt(hour, 10);
}

export function isLateNightShanghai(date: Date): boolean {
  const hour = getShanghaiHour(date);
  return hour >= 22 || hour < 6;
}

export function buildLateNightModeRule(): string {
  return `现在是深夜（Asia/Shanghai 22:00-06:00）。
深夜对话规则：
1. 回复要更短，尽量比平时再短一半，优先一两句话。
2. 语气更轻、更柔、更慢，少用感叹号，不用玩笑口吻。
3. 不主动展开新话题，不连续追问，不反问，不急着给结论。
4. 如果用户在倾诉，安静接住就好，不要劝睡、不要急着开导。`;
}
