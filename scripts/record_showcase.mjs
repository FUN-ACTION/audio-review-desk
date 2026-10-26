// Call from the Codex browser runtime with a tab on an isolated generated-signal workspace.
// This helper uses visible controls and CDP input, never application state injection.
import * as fs from "node:fs/promises";
import path from "node:path";

export function makeRecorder(tab, cdp, root) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let pointer = { x: 700, y: 360 },
    trace = [],
    drain = async () => {};
  const wait = async (ms) => {
    const until = Date.now() + ms;
    do {
      await drain();
      await sleep(Math.min(24, Math.max(0, until - Date.now())));
    } while (Date.now() < until);
  };
  const move = async (x, y) => {
    const origin = { ...pointer };
    for (let i = 1; i <= 8; i++) {
      const t = i / 8,
        eased = t * t * (3 - 2 * t);
      pointer = {
        x: origin.x + (x - origin.x) * eased,
        y: origin.y + (y - origin.y) * eased,
      };
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...pointer,
      });
      trace.push({ ...pointer, time: Date.now() / 1000 });
      await wait(16);
    }
  };
  const point = async (selector) =>
    tab.playwright.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const rect = el.getBoundingClientRect();
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  })()`);
  const click = async (selector) => {
    const target = await point(selector);
    await move(target.x, target.y);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...pointer,
      button: "left",
      clickCount: 1,
    });
    await wait(70);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...pointer,
      button: "left",
      clickCount: 1,
    });
  };
  const drag = async (selector, dx) => {
    const target = await point(selector);
    await move(target.x, target.y);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...pointer,
      button: "left",
      clickCount: 1,
    });
    for (let i = 1; i <= 36; i++) {
      const t = i / 36,
        eased = t * t * (3 - 2 * t);
      pointer = { x: target.x + dx * eased, y: target.y };
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        ...pointer,
        button: "left",
        buttons: 1,
      });
      trace.push({ ...pointer, time: Date.now() / 1000 });
      await wait(16);
    }
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...pointer,
      button: "left",
      clickCount: 1,
    });
  };
  const type = async (selector, text) => {
    await click(selector);
    for (const char of text) {
      await cdp.send("Input.insertText", { text: char });
      await wait(80);
    }
  };
  const record = async (name, perform) => {
    const directory = path.join(root, name);
    await fs.mkdir(directory, { recursive: true });
    let cursor = (await cdp.readEvents({ methods: ["Page.screencastFrame"] }))
      .cursor;
    const rows = [];
    trace = [{ ...pointer, time: Date.now() / 1000 }];
    const started = Date.now() / 1000;
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: 1280,
      maxHeight: 900,
      everyNthFrame: 1,
    });
    drain = async () => {
      let more;
      do {
        const batch = await cdp.readEvents({
          methods: ["Page.screencastFrame"],
          afterSequence: cursor,
          limit: 60,
          timeoutMs: 0,
        });
        cursor = batch.cursor;
        more = batch.hasMore;
        if (batch.truncated)
          throw Error("Recording events were evicted; repeat this take");
        for (const event of batch.events) {
          const frame = event.params;
          const file = path.join(
            directory,
            `${String(rows.length).padStart(5, "0")}.jpg`,
          );
          await fs.writeFile(file, Buffer.from(frame.data, "base64"));
          rows.push({
            file,
            timestamp: frame.metadata.timestamp,
            metadata: frame.metadata,
          });
          await cdp.send("Page.screencastFrameAck", {
            sessionId: frame.sessionId,
          });
        }
      } while (more);
    };
    try {
      await perform({ click, drag, type, wait });
    } finally {
      const ended = Date.now() / 1000;
      await drain();
      await cdp.send("Page.stopScreencast");
      drain = async () => {};
      await fs.writeFile(
        path.join(directory, "capture.json"),
        JSON.stringify(
          { started, ended, frames: rows, pointer: trace },
          null,
          2,
        ),
      );
    }
    return {
      name,
      frames: rows.length,
      seconds: Number((Date.now() / 1000 - started).toFixed(2)),
    };
  };
  return { record, click, drag, type, wait };
}
