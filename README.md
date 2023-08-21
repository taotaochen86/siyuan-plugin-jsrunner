# ����JS�ű�

����HTTP�����������пͻ��˷��͹������ⲿJavascriptƬ�Σ������䷵�ؽ����

## ����ʾ����

������C#Ϊ������ȡ��ǰ���block_id�͵�ǰ�ĵ���block_id


### c#��ȡsiyuan�ʼǵ�block_id
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

### c#��ȡsiyuan�ʼǵ�ǰ�ĵ� block_id
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