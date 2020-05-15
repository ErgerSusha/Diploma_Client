import Vue from 'vue'
import App from './App.vue'
import 'ant-design-vue/dist/antd.css'
import { Button } from "ant-design-vue";

Vue.config.productionTip = false;

Vue.use(Button);

new Vue({
  render: h => h(App)
}).$mount('#app')
