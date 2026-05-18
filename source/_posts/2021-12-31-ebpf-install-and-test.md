---
title: "ebpf之bcc的安装及测试"
date: 2021-12-31 21:47:30
categories: [内核技术]
nav: 技术
tags: [ebpf]
---

bcc的安装貌似有些坑，开始我再ubuntu上按照[官方文档](https://github.com/iovisor/bcc/blob/master/INSTALL.md#ubuntu---source)安装后运行失败了，有点帖子说需要自己编译安装。但是我的vps每次编译bcc都挂，后来换成centos8用下载rpm包安装成功了。

## ubuntu 20.04

尝试apt安装失败（[issue](https://github.com/iovisor/gobpf/issues/214)），源码编译安装，机器负载过高失败。最后参考帖子下周release的源码编译安装，机器仍然负载过高没有结果。

这tm也太曲折了。可现在ebpf这么火，虽然bbc可能不如cilium应用得多。但是bbc推出得更早，而且可以对接python，应用的人也很多，安装方面不应该这么多坑才对。所以重新调整一下，放弃源码编译安装。把虚拟机重装成了centos8系统，准备直接安装rpm包。

## centos8

在网站查看bcc相关rpm包，用dnf安装了3个包：

- bcc-devel

- bcc

- bcc-tools

```bash
  dnf install bcc-tools
  dnf install bcc
  dnf –enablerepo=powertools install bcc-devel

  git clone git@github.com:DavadDi/bpf_demo.git
  ./main –binary ../tracee/main -func main.ebpfDemo
```

成功了，并且测试了一个用ebpf修改函数参数的小demo。可以开始学习了。

但是遗憾的是，在做http相关测试的时候报错了：

```
    /root/go/pkg/mod/github.com/iovisor/gobpf@v0.0.0-20200614202714-e6b321d32103/bcc/module.go:261:33: not enough arguments in call to _C2func_bpf_attach_uprobe
            have (_Ctype_int, uint32, *_Ctype_char, *_Ctype_char, _Ctype_ulong, _Ctype_int)
            want (_Ctype_int, uint32, *_Ctype_char, *_Ctype_char, _Ctype_ulong, _Ctype_int, _Ctype_uint)
```

搜索到一个[issue](https://github.com/containers/oci-seccomp-bpf-hook/issues/69)怀疑是bcc-devel的版本低，有人编译bcc解决。

# 测试

## 测试静态跟踪点（usdt）

看了这个[文章](https://ebpf.top/post/ebpf-overview-part-5/)

期间安装了一些python设置跟踪点的依赖（centos8中进行）

```bash
    dnf install elfutils-libelf-devel
    # dnf报错，编译安装解决
    git clone git@github.com:sthima/libstapsdt.git
    cd libstapsdt/
    make
    yum install yum -y install gcc automake autoconf libtool make
    yum -y install gcc automake autoconf libtool make
    make
    make install
    ldconfig

    pip3 install stapsdt
```

## 动态探针（uprobes）

静态跟踪点的问题在于，它们需要在源代码中明确定义，并且在修改跟踪点时需要重新构建应用程序。保证现有跟踪点的 ABI 稳定性对维护人员如何重新构建/重写跟踪点数据的代码施加了限制。

bcc的example[gethostlatency.py](https://github.com/iovisor/bcc/blob/master/tools/gethostlatency.py) 示范了用监控所有dns的查询用时。有几个点可以关注下，后面自己写程序用得到：

- 读取参数的c宏PT_REGS_PARM1。根据[帖子](https://mozillazg.com/2021/05/ebpf-gobpf-get-function-argument-values-from-pt_regs.html)
- bpf_get_current_comm
- [bpf_get_current_pid_tgid](https://www.ebpf.top/post/ebpf_prog_pid_filter/)。高 32 位置为 tgid ，低 32 位为 pid(tid)。
- BPF_HASH(start, u32, struct val_t);声明一个start数据结构，entry写，return读并删。
- BPF_PERF_OUTPUT。BPF_PERF_OUTPUT(events);声明，events.perf_submit生成输出数据，PYTHON代码中B["events"].event(data)接受数据。

但是这个程序有个点不太理解，c中在entry中用线程tgid作为key记录时间、host等信息，return中用tgid在BPF_HASH中读取出来，如果一个go进程重复的进行curl，我理解可能会在一个线程（go PMG中的P）中进行，可能会是一个线程吧？那这个tgid怎么记录呢，会不会乱呢？

### 测试一

写了一个bash，进行几次curl请求。并将curl请求扔进后台进行处理。发现两次pid及tgid均不同，难道每次curl是启动一个新进程？

### 测试二

写了个go代码循环请求某域名，但是发现go进行http请求gethostlatency.py竟然无任何输出！ 用gccgo编译也不行，目前尚不知道原因。。。

### 测试三：go函数lantency

想测试bcc的funclantency，搞了半天搞不通。发现go的bcc包的/usr/lib/python3.6/site-packages/bcc/\_\_init\_\_.py 好像有点问题，path.encode()是byte，不能直接和string相加。可能是python版本问题？不太清楚，反正python3.6这样改一下就好了：

```python
    - exe_file = os.path.join(path.encode(), bin_path)
    + #exe_file = os.path.join(path.encode(), bin_path)
    + exe_file = os.path.join(path, bin_path)
```

又yum安装了gccc-go，可以测试了。

先用gccgo编译并运行

```bash
    # gccgo -o app t.go
    # ./app
```

在另一终端运行funclatency分析fmt.Println调用时长

```bash
    # ./funclatency 'go:fmt.Println'

    Function = b'fmt.Println' [79990]
    nsecs               : count     distribution
    0 -> 1          : 0        |                                        |
    2 -> 3          : 0        |                                        |
    4 -> 7          : 0        |                                        |
    8 -> 15         : 0        |                                        |
    16 -> 31         : 0        |                                        |
    32 -> 63         : 0        |                                        |
    64 -> 127        : 0        |                                        |
    128 -> 255        : 0        |                                        |
    256 -> 511        : 0        |                                        |
    512 -> 1023       : 0        |                                        |
    1024 -> 2047       : 0        |                                        |
    2048 -> 4095       : 0        |                                        |
    4096 -> 8191       : 0        |                                        |
    8192 -> 16383      : 3        |*******                                 |
    16384 -> 32767      : 12       |****************************            |
    32768 -> 65535      : 17       |****************************************|
    65536 -> 131071     : 2        |****                                    |
    avg = 37622 nsecs, total: 1279163 nsecs, count: 34
```

### 测试四：获取函数调用及参数

```go
    # cd /root/go/src
    # cat add.go

            package main

            import "fmt"

            func add(x int, y int) int {
            return x + y
            }
            func main() {
            fmt.Println(add(42, 13))
            }
```

```bash
    # gccgo -o add add.go
    # ./add
```

在另一终端运行

```bash
    # trace '/root/go/src/add:main.add' "%d %d" arg1, arg2'
    PID     TID     COMM            FUNC             -
    80046   80046   add             main.add         42 13
```

这里注意：这里是gccgo编译的。如果是go编译，因为Go gc编译器并不遵循标准的 AMD ABI 函数调用约定， 这导致这个调试器或者其它的调试器跟踪参数有问题(我以前也听过前同事抱怨过这个问题)。我猜Go需要使用一个不同的ABI来返回值， 因为它需要返回多个值。（抄的[大神的博客](https://www.brendangregg.com/blog/2017-01-31/golang-bcc-bpf-function-tracing.html)，详情请见原文）

不知道大神改了啥，从go栈地址拿到了参数内容。我就跳过了，估计短期我还用不到这，惭愧。

### 测试五：监控程序产生的的http包

iovisor/bcc的examples/networking/http_filter已经写好了bcc过滤http请求及结果的demo。测试http-parse-simple，python代码判断了ethernet包头、ip包头、tcp包头的长度，然后打印了package payload第一行。

例如

```
    HTTP/1.1 200 OK
    GET /opc/v2/instance/ HTTP/1.1
```

这是两个包，第一个是request，第二个是response。因为已经读取出内容，所以我判断应该可以读取出host等其他内容。稍作修改并打印出来：

```
    GET /e HTTP/1.1
    all package content：\x02\x00\x17\x00\xfc\x7f\x00\x00\x17 \x15\xd6\x08\x00E\x00\x02\n\x00\x00@\x001\x06f\x91=\x87\x98\xfd\n\x00\x00\xd9\xf8\xeb#\x82\x02L\x98m8L\xbe\x12\x80\x18\x08\x02\xf5\xe6\x00\x00\x01\x01\x08\n\x84F\x91E\x87\x04\xdb\xadGET /e HTTP/1.1\r\nHost: myor2:9090\r\nConnection: keep-alive\r\nCache-Control: max-age=0\r\nUpgrade-Insecure-Requests: 1\r\nUser-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36\r\nAccept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9\r\nAccept-Encoding: gzip, deflate\r\nAccept-Language: zh-CN,zh;q=0.9,en;q=0.8\r\n\r\n

    HTTP/1.1 200 OK
    all package content：\x00\x00\x17 \x15\xd6\x02\x00\x17\x00\xfc\x7f\x08\x00E\x00\x00\xb4XN@\x00@\x06\x00\x99\n\x00\x00\xd9=\x87\x98\xfd#\x82\xf3\xb0\xa6\xa1\xbbe\xe0\xb4\xa5\x9b\x80\x18\x03\x92\xe2\x03\x00\x00\x01\x01\x08\n\x86\xfc\xd5E\x84>\x99WHTTP/1.1 200 OK\r\nDate: Wed, 22 Dec 2021 08:36:59 GMT\r\nContent-Length: 11\r\nContent-Type: text/plain; charset=utf-8\r\n\r\ne = 2.7183\n
```

可以看到，其实可以从request包中拿到Host以及http header。但是这里有个问题，如何将request和response对起来呢？从http-parse-complete可以看到，是用源、目的ip/port4元组将request和response联系起来的。不过我的环境里response运行不通过，ip和port的偏移量有问题。

受http-parse-complete.py的启发，可以用4元组做记录request并在response到来的时候计算duration。这样可以用作http的监控了。不需要日志、监控，甚至不需要业务的配合，简直完美！不过遗憾的是我的环境下complete跑步起来，判断ip的偏移量有问题。

另外吐槽下python。开始python代码执行报错，开始以为我环境或者版本问题，后来才发现是python2函数引起的问题。不知道python的bug程序员都怎么标注python版本？这个破问题我还查了半天。。。

## bcc/tools

bcc还提供了很多其他工具，比如java或python的分析。

## iovisor/gobpf

这是个依赖bcc的go repo，可以将向bcc的python工具一样使用bcc功能。测试了非常简单的库github.com/DavadDi/bpf_demo，其中bpf_go_tracer监听go函数并且替换掉了其中的参数。

但是当我测试pixie-io/pixie-demos遇到了问题。首先是因为版本问题buildsimple-gotracing/http_trace_uprobe不通过，后来我升级了github.com/iovisor/gobpf版本又报了另一个错误：

```
    ./utils.go:66:33: not enough arguments in call to _C2func_bpf_attach_uprobe
            have (_Ctype_int, uint32, *_Ctype_char, *_Ctype_char, _Ctype_ulong, _Ctype_int)
            want (_Ctype_int, uint32, *_Ctype_char, *_Ctype_char, _Ctype_ulong, _Ctype_int, _Ctype_uint)
```

utils.go有个bpf_attach_uprobe缺少了一个参数。看代码是因为bcc版本不对造成的，网上说用bcc 0.17没问题，不过我没有再测试了以后有时间再补上吧。

# TODO

bcc有很多工具。初步测算了tcpaccept/tcptracer/profile等。可以初步看看有用的工具。

遗留问题：

-需要查看为什么gethostlatency抓不到go的http请求
-怎么查看各种服务的http请求及处理结果
-pixie-io/pixie-demos的simple-gotracing
-go处理拿到http以及funclantency
