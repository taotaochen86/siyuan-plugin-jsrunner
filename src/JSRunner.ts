const http = globalThis.require("http");
export default class JSRunner {
    private server;
    private port: number;
    constructor(port = 49465) {
        this.port = port;
    }
    public start(): void {
        if (!this.server) {
            this.server = http.createServer(async (req, res) => {
                if (req.method == "POST") {
                    const body = await this.getBody(req);
                    const result = eval(body);
                    res.end(JSON.stringify(result));

                } else {
                    res.end("支持POST方式！");
                }
            });
            this.server.listen(this.port);
            console.log(`已开启服务,端口${this.port}`);
        }
    }
    Restart(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
            this.start();
            console.log(`已重启服务,端口${this.port}`);
        }
    }
    Stop(): void {
        if (this.server) {
            this.server.close();
            console.log(`已关闭服务,端口${this.port}`);
        }
    }
    private getBody(request) {
        return new Promise(
            (resolve) => {
                const bodyParts = [];
                let body;
                request.on("data", (chunk) => {
                    bodyParts.push(chunk);
                }).on("end", () => {
                    body = Buffer.concat(bodyParts).toString();
                    resolve(body);
                });
            });
    }
}