import { defineComponent, h } from "vue";
import { createRouter, createWebHistory } from "vue-router";

const RouteStub = defineComponent({
  name: "RouteStub",
  setup() {
    return () => h("div");
  },
});

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: RouteStub },
    { path: "/:machineId/:threadId", name: "thread", component: RouteStub, props: true },
    { path: "/settings", name: "settings", component: RouteStub },
    { path: "/archived", name: "archived", component: RouteStub },
    { path: "/about", name: "about", component: RouteStub },
    { path: "/pro", name: "paywall", component: RouteStub },
    { path: "/onboarding", name: "onboarding", component: RouteStub },
    { path: "/login", name: "email-otp", component: RouteStub },
    { path: "/subscribe", name: "subscription-gate", component: RouteStub },
    { path: "/bootstrap-failure", name: "bootstrap-failure", component: RouteStub },
    { path: "/:pathMatch(.*)*", redirect: { name: "home" } },
  ],
});
