- 项目介绍：@README.md
- 每次更改代码后都要使用git提交代码并在需要时用tag打版本，完成后更新tampermonkey脚本：
```python
# 在当前目录起一个本地服务，然后浏览器访问 http://127.0.0.1:8765/bilibili-remove-covers.user.js
python -m http.server 8765 --bind 127.0.0.1
```
然后打开对应页面即可看到效果（脚本 `@run-at document-start`，无闪屏）。