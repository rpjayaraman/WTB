import json, urllib.request

code = """
module top_tb;
    logic clk;

    initial begin
        clk = 0;
        forever #5 clk = ~clk;
    end

    initial begin
        #100;
        $display("SIMPLE CLOCK FINISH");
        $finish;
    end
endmodule
"""

req_data = json.dumps({
    "command": "xezim --simulate $FILE",
    "code": code
}).encode("utf-8")

req = urllib.request.Request("https://wtb-sim.onrender.com/lint", data=req_data, headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        print("EXIT CODE:", res.get("exit_code"))
        print("STDOUT:\n", res.get("stdout"))
        print("STDERR:\n", res.get("stderr"))
except Exception as e:
    print("ERROR:", e)
