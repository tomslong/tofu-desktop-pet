const IDLE = [
  "今天也要好好写代码。大概。",
  "你敲键盘，我负责可爱。",
  "这个 bug 看起来有点眼熟。",
  "摸鱼中，勿扰。",
  "保存了吗？我就问问。",
  "喝口水吧，人类。",
  "我刚刚眨眼了，你看到了吗？",
  "需要摸摸的话，我在这里。",
  "代码会有的，饼干也会有的。",
  "正在假装很忙。",
  "你的光标好闪。",
  "要不要先跑一下测试？",
  "别担心，编译器也有心情。",
  "一只猫路过，并留下了祝福。",
  "今天的代码，明天的遗产。",
];

const MORNING = [
  "早。先编译一个好消息。",
  "早安，今天从一杯水开始。",
  "太阳出来了，可以 ship 了。",
];

const NIGHT = [
  "夜深了，bug 们也该睡了。",
  "这个点还写代码？我陪你。",
  "月亮下班前，记得保存。",
  "熬夜会掉毛的，人类。",
];

const START = [
  "开工！先伸个懒腰。",
  "来活了，我坐好。",
  "收到，爪子已就位。",
];

const IDLE_AGENT = [
  "嗯…让我想想。",
  "这个逻辑，有点意思。",
  "盯着代码看，它会自己变对吗？",
];

const DONE = [
  "搞定。奖励一块小饼干？",
  "收工，爪子都热了。",
  "绿了绿了！",
  "这波可以。",
  "编译通过，猫猫满意。",
];

const FAIL = [
  "啊哦，红了。",
  "报错了，但我还爱你。",
  "不是你的错。大概是。",
  "红色很显眼，但不是我的颜色。",
];

const WAITING = [
  "需要你点一下。",
  "我在等你的决定。",
  "轮到你啦，人类。",
  "这里，看这里。",
];

const SESSION_END = [
  "下班。我也下班。",
  "今天到这里，明天继续。",
  "收工。我去晒太阳了。",
];

const PAT = [
  "咕噜咕噜。",
  "再摸一下。",
  "好，今天也喜欢你。",
  "这里是充电口。",
  "手法不错，继续。",
];

const FEED = [
  "咔嚓咔嚓。",
  "小饼干，我的最爱。",
  "热量是友谊的燃料。",
  "谢谢，尾巴已翘起。",
];

const NO_TREATS = [
  "饼干盒空了…",
  "没有了，但心意收到。",
  "等会儿再吃，先摸摸。",
];

const PLAY = [
  "接住！",
  "再玩一次！",
  "尾巴已就位。",
  "这个游戏我能玩一天。",
];

const NAP = [
  "睡五分钟…",
  "别吵，充电中。",
  "呼噜呼噜…",
];

const DRAG = [
  "放我下来！",
  "飞起来了。",
  "这个高度有点刺激。",
  "搬家？也不先打个招呼。",
];

const FIRST_RUN = [
  "嗨，我是 Tofu。点我、拖我，右键有饼干。",
  "新桌面，新猫。先摸摸我熟悉一下？",
];

const TOOL_COPY = {
  read: ["翻文件，找线索。", "读一下，别急。", "这页有点长。"],
  grep: ["在代码里嗅来嗅去…", "搜一下，马上。", "关键词藏哪儿了？"],
  glob: ["看看都有什么文件。", "目录侦察中。"],
  write: ["落笔，轻一点。", "写进去。希望别覆盖。", "新文件，新气息。"],
  edit: ["挪一点点像素…", "改这里，还是那里？", "手术很成功。"],
  bash: ["跑命令中，退后。", "终端时间。", "让子弹飞一会儿。"],
  shell: ["跑命令中，退后。", "终端时间。"],
  test: ["测试精灵正在加班。", "等绿灯。", "跑测试，别眨眼。"],
  web: ["上网查一下，马上回来。", "外面的世界很大。"],
  task: ["拆任务中…", "一步一步来。"],
  agent: ["派了一只小猫去干活。", "子任务，启动。"],
  default: ["处理中，爪子很忙。", "让我看看。", "正在努力。"],
};

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function idleLine(hour) {
  if (hour < 5) return pick(NIGHT);
  if (hour < 10) return pick(MORNING);
  if (hour >= 23) return pick(NIGHT);
  return pick(IDLE);
}

export function toolLine(tool = "") {
  const key = String(tool).toLowerCase();
  const match = Object.keys(TOOL_COPY).find((name) => key === name || key.includes(name));
  return pick(TOOL_COPY[match] || TOOL_COPY.default);
}

export function toolState(tool = "", phase = "pre") {
  const key = String(tool).toLowerCase();
  if (phase === "post") return "review";
  if (["read", "grep", "glob", "review"].some((name) => key.includes(name))) return "review";
  return "working";
}

export const copy = {
  start: () => pick(START),
  idleAgent: () => pick(IDLE_AGENT),
  done: () => pick(DONE),
  fail: () => pick(FAIL),
  waiting: () => pick(WAITING),
  sessionEnd: () => pick(SESSION_END),
  pat: () => pick(PAT),
  feed: () => pick(FEED),
  noTreats: () => pick(NO_TREATS),
  play: () => pick(PLAY),
  nap: () => pick(NAP),
  drag: () => pick(DRAG),
  firstRun: () => pick(FIRST_RUN),
};
