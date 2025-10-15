const NOVELAI_API_ENDPOINT = 'https://image.novelai.net/ai/generate-image';

interface QueueItem {
  body: any;
  resolve: (res: Response) => void;
  reject: (reason?: any) => void;
}

class NovelAiQueue {
  private queue: QueueItem[] = [];
  private processing = false;

  enqueue(body: any): Promise<Response> {
    return new Promise((resolve, reject) => {
      this.queue.push({ body, resolve, reject });
      this.processNext();
    });
  }

  private async processNext() {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    this.processing = true;
    const item = this.queue.shift()!;

    try {
      const res = await fetch(NOVELAI_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_NOVELAI_API_KEY ?? ''}`,
        },
        body: JSON.stringify(item.body),
      });
      item.resolve(res);
    } catch (err) {
      item.reject(err);
    } finally {
      setTimeout(() => {
        this.processing = false;
        this.processNext();
      }, 5000);
    }
  }
}

export const novelAiQueue = new NovelAiQueue();
