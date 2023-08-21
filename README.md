# 运行JS脚本

创建HTTP服务器，运行客户端发送过来的外部Javascript片段，并向其返回结果！

## 代码示例：

下面以C#为例，获取当前块的block_id和当前文档的block_id


### c#获取siyuan笔记当block_id
```c#
    string url = "http://localhost:49465";
    string data = """
    document.querySelector("div:not(.fn__none).fn__flex-1.protyle .protyle-breadcrumb__item:not(.protyle-breadcrumb__item--active)").attributes["data-node-id"].value
    """;
    var body = new StringContent(data, Encoding.UTF8, "application/json");
    using HttpClient client = new HttpClient();
    HttpResponseMessage response = await client.PostAsync(url, body).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
    string responseBody = await response.Content.ReadAsStringAsync();
```

### c#获取siyuan笔记当前文档 block_id
``` c#
     string url = "http://localhost:49465";
    string jsCode = """
    document.querySelector("div:not(.fn__none).fn__flex-1.protyle .protyle-breadcrumb__item--active").attributes['data-node-id'].value
    """;
    var body = new StringContent(data, Encoding.UTF8, "application/json");
    using HttpClient client = new HttpClient();
    HttpResponseMessage response = await client.PostAsync(url, body).ConfigureAwait(false);
    response.EnsureSuccessStatusCode();
    string responseBody = await response.Content.ReadAsStringAsync();
```



# siyuan-plugin-jsrunner

Run jscode from post request and return the result to the client-side

## Parameters:
url: http://localhost:49465/
Http methods: Post