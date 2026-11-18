async function readTerminal(response, receive) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (line.trim()) receive(JSON.parse(line));
      if (done) {
        if (buffer.trim()) receive(JSON.parse(buffer));
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
