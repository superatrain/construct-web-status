/**
* Todo:
* MDNS for per-printer status.
* Elapsed time, temp gauages, printer status (Idle/Printing/ESTOP)
*/

// The ugly:
function add_printer(printer){
  // Printer area template:
  div=$("<div>");
  div.attr("class","printer");
  div.attr("id",printer.id);
  div.append("<div class='row'><center><h1>"+printer.printer_name+"</h1></center></div>");
  div.append("<div class=\"row\">"+
      "<div class=\"col-md-3\"> "+
         "<div id=\"status-"+printer.id+"\" style=\"width:250px; height:160px\"></div>"+
         "<div class=\"progress\"><div class=\"progress-bar\" role=\"progressbar\" aria-valuenow=\"0\" aria-valuemin=\"0\" aria-valuemax=\"255\" style=\"width: 0%;\" id=\"temp-bar-"+printer.id+"\">"+
           "<span class=\"sr-only\" id=\"temp-"+printer.id+"\"></span>"+
         "</div></div>"+
      "</div><div class=\"col-md-9\"> "+
           "<table class=\"table table-striped\"> "+
              "<thead><tr><th>#</th>"+
              "<th>Filename</th><th>Status</th><th>Percent</th></tr></thead>"+
              "<tbody class=\"job_list\"></tbody>"+
           "</table></div></div>"+
      "</div><hr />");

  $(".container").append(div);

  // Load Gages into above template:
  var g = new JustGage({
    id: "status-"+printer.id,    value: 0,
    min: 0,    max: 100, label:"%",
    title: printer.printer_name+" Status"
    });
  // Keep references: (can use pg[i].refresh(value) to update)
  printer.gage=g;

  // Populate into table:
  redraw_jobs(printer.job_list,printer);
} // End add_printer




// Creates / updates job table:
function redraw_jobs(job_list, printer){
 var tbody = $("#"+printer.id+' tbody');
 tbody.empty(); // Empty existing table.

 // Add jobs to table:
 $.each (job_list,function(i,job){
      if (job.status == "done") return; // Do not add done jobs.
      if (job.status === undefined)
        job.status = "Queued";

      var tr = $('<tr>');
      tr.append($('<td>').html(job.id));
      tr.append($('<td>').html(job.file_name));
      tr.append($('<td>').html(job.status));
      if (job.current_line !== undefined && job.total_lines !== undefined)
      {
        percent = (job.current_line * 100) / job.total_lines;
        tr.append($('<td>').html(parseInt(percent))); 
      }
      else
      {
        tr.append($('<td>').html("&nbsp"));
      }
      if (job.status=="printing")
        tr.attr("class","table_active_job");

      tbody.append(tr);
  });

  // Pad list length:
  while ($("#"+printer.id+" tr").length < 4)
  {
    tr = $("<tr>");
    tr.append($("<td>").html("&nbsp"));
    tr.append($("<td>").html("&nbsp"));
    tr.append($("<td>").html("&nbsp"));
    tr.append($("<td>").html("&nbsp"));
    tbody.append(tr);
  }
}




function refresh_print_display(printer, job){
  percent = (printer.job_list[job].current_line * 100) / printer.job_list[job].total_lines;
  printer.gage.refresh(parseInt(percent));
  // Status is in table too now.
  redraw_jobs(printer.job_list, printer);
}





function connect (printer){
var socket = new WebSocket("ws://"+printer.ip+":2540/printers/"+printer.id+"/socket?user=admin&password=admin");
    socket.onclose = function()
    {
      $(".container #"+printer.id).remove();
      console.log("Connection lost, Printer removed.");
      printer.connected = false;
    }
    socket.onopen = function()
    {
      add_printer(printer);
      console.log ("WebSocket Opened.");
      printer.connected=true;
    }  
    socket.onmessage = function(msg){  
        /* ALL THE DEBUG:
        if (msg.data.indexOf("e0")<0)
          console.log("DBG1-"+msg.data);
        if (msg.data.indexOf("init")>=0)
        {
          console.log("DBG1:");
          console.log(jQuery.parseJSON(msg.data));
        }
        */
        //if (msg.data.indexOf("temp")<0) console.log(msg.data);
        $.each(jQuery.parseJSON(msg.data), function(i,item)
        {

          // Job handling:
          if (item.target !== undefined && item.target.substring(0,5) == "jobs[") // Add / Delete / Change
          {
            if (printer.job_list[item.target] !== undefined)
              jQuery.extend(printer.job_list[item.target],item.data);
            else
              printer.job_list[item.target]=item.data;
            if (item.type == "rm") delete printer.job_list[item.target];
            // Redraw gage on line change:
            if (item.type == "change" && msg.data.indexOf("current_line") >=0)
              refresh_print_display(printer,item.target);
            // Redraw table:
            if (item.type == "rm" || (Object.keys(item.data).filter(function(k){ return (k!="current_line"); }).length >0))
              redraw_jobs(printer.job_list,printer);
          }

          // Temp Gague
          if (msg.data.indexOf("current_temp")>=0)
            if (item.data && item.target && item.data.current_temp && item.target.substring(0,1) == "e")
            {
              temp = item.data.current_temp;
              bar = $( "#temp-bar-"+printer.id );
              bar.attr("style","width: "+temp*100/255+"%");
              // Coloring:
              if (temp < 60) bar.removeClass("progress-bar-warning progress-bar-danger").addClass("progress-bar-success");
              else if (temp < 150 ) bar.removeClass("progress-bar-success progress-bar-danger").addClass("progress-bar-warning");
              else bar.removeClass("progress-bar-success progress-bar-warning").addClass("progress-bar-danger");
            }
 
          // Initialization: (first jobs, states)

          if (item.type == "initialized")
          {  
            if (item.data.status !== undefined)
              printer.status = item.data.status;
            $.each(item.data,function(key,val){
              if (key.substring(0,5) == "jobs[")
                printer.job_list[key]=val;
            });
            $.each(item.data.jobs, function(i,job) // This is old deprecated jobs[] format...
            {
              printer.job_list["jobs["+job.id+"]"]=job;
            });
            redraw_jobs(printer.job_list,printer);
          }

          // Printer status:
          if (item.type == "change" && item.data.status !== undefined)
            printer.status = item.data.status
        });

      // Ugly hack to reset (for now)
      if (printer.status != "printing") printer.gage.refresh(0);
    }  
}

// Quick hack to fix dropped connections: (once/minute reconnect attemped)
function lazy_reconnect(){
  $.each(printer_list,function(i,printer){
    if (! printer.connected)
    {
      connect(printer);
    }
  });
}

setInterval(lazy_reconnect,60000);

// Example usage:
printer_list=[
  {"id":"ultimaker_1","printer_name":"Ultimaker","ip":"ultimaker2","job_list":{},"connected":false},
  {"id":"ultimaker_2_the_reckoning","printer_name":"Ultimaker 2","ip":"ultimaker","job_list":{},"connected":false},
  {"id":"breakerbot","printer_name":"BreakerBot","ip":"cupcake","job_list":{},"connected":false},
  {"id":"null","printer_name":"Null_1","ip":"127.0.0.1","job_list":{},"connected":false},
  ];
connect(printer_list[0]);
connect(printer_list[1]);
connect(printer_list[2]);
connect(printer_list[3]);

