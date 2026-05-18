const Hexo = require('hexo');
const hexo = new Hexo(process.cwd(), {});
hexo.init().then(function() {
  return hexo.call('server', {});
}).catch(function(err) {
  console.error(err);
  process.exit(1);
});
